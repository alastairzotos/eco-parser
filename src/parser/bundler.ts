import { Dictionary } from 'lodash';
import * as path from 'path';
import * as prettier from 'prettier';

import { fileToSource } from './nodes';
import { Parser } from './parser';

export interface IResolvedFileName {
    name: string;
    currentDir?: string;
}

export type IFileNameResolver = (
    currentDir: string,
    filename: string
) => Promise<IResolvedFileName>;

export type IImportResolver = (filePath: string) => Promise<string>;

export interface INamedExport {
    name: string;
    alias?: string;
}

export interface IBundleOptions {
    prettyPrint?: boolean;
}

export interface IBundlerContext {
    currentDir: string;
    exports: INamedExport[];
    defaultExport: string;
    hasImports: boolean;
}

export interface IBundlerFile {
    name: string;
    content: string;
    hasExports: boolean;
    hasImports: boolean;
}

const REQUIRE_NAME = '__eco_require__';
const SKELETON_MODULE_SECTION = '%%%__MODULES__%%%';
const SKELETON_ENTRY_SECTION = '%%%__ENTRYPOINT__%%%';

// tslint:disable-next-line
const SKELETON = `((modules) => {const cachedModules = {};const ${REQUIRE_NAME} = (moduleId) => {if (cachedModules[moduleId]) {return cachedModules[moduleId].exports;}const module = {exports: {}};cachedModules[moduleId] = module;modules[moduleId](module, ${REQUIRE_NAME});return module.exports;};return __eco_require__("${SKELETON_ENTRY_SECTION}");})({${SKELETON_MODULE_SECTION}});`;

export class Bundler {
    private fileNameResolver: IFileNameResolver;
    private importResolver: IImportResolver;
    private context: IBundlerContext[] = [];
    private files: Dictionary<IBundlerFile> = {};

    onResolveFilename = (resolver: IFileNameResolver) => {
        this.fileNameResolver = resolver;
    }

    onResolveImport = (resolver: IImportResolver) => {
        this.importResolver = resolver;
    }

    bundle = (currentDir: string, fileName: string, options: IBundleOptions = {}): Promise<string> =>
        new Promise(async (resolve, reject) => {
            try {
                options = { prettyPrint: false, ...options };
                await this.bundleFile(currentDir, fileName);

                const generateFileModule = (file: IBundlerFile) => {
                    const params: string[] = [
                        file.hasExports ? 'module' : '_'
                    ];

                    if (file.hasImports) {
                        params.push(REQUIRE_NAME);
                    }

                    return `"${file.name}": (${params.join(', ')}) => {${file.content}}`;
                };

                const modules = Object.values(this.files)
                    .map(file => generateFileModule(file))
                    .join(', ');

                const output = SKELETON
                    .replace(SKELETON_ENTRY_SECTION, fileName)
                    .replace(SKELETON_MODULE_SECTION, modules);

                resolve(
                    options.prettyPrint ?
                        prettier.format(
                            output,
                            { parser: 'babel' }
                        ) :
                        output
                );
            } catch (e) {
                reject(e);
            }
        })

    resolveFileName = (currentDir: string, filename: string) =>
        this.fileNameResolver(currentDir, filename)

    handleSourceImport = (filename: string): Promise<string> =>
        new Promise(async (resolve, reject) => {
            try {
                const ctx = this.getContext();
                ctx.hasImports = true;
                const filePath = await this.bundleFile(this.getContext().currentDir, filename);
                resolve(`${REQUIRE_NAME}('${filePath}')`);
            } catch (e) {
                reject(e);
            }
        })

    addExport = (name: string, alias?: string) => {
        this.getContext().exports.push({ name, alias });
    }

    setDefaultExport = (defaultExport: string) => {
        this.getContext().defaultExport = defaultExport;
    }

    private bundleFile = (currentDir: string, fileName: string): Promise<string> =>
        new Promise(async (resolve, reject) => {
            try {
                let contextDir = path.join(currentDir, path.dirname(fileName));
                const resolved = await this.resolveFileName(contextDir, path.basename(fileName));
                contextDir = resolved.currentDir;

                if (resolved.name in this.files) {
                    resolve(resolved.name);
                    return;
                }

                this.files[resolved.name] = null;

                this.pushContext(contextDir);
                const ctx = this.getContext();

                const resolvedImport = await this.importResolver(resolved.name);
                const parser = new Parser(resolvedImport);
                const nodes = parser.parse();

                const content = await fileToSource(nodes, this) + this.formatExports();
                const hasImports = this.getContext().hasImports;
                const hasExports = ctx.defaultExport !== null || ctx.exports.length > 0;

                this.files[resolved.name] = {
                    name: resolved.name,
                    hasExports,
                    hasImports,
                    content
                };

                this.popContext();

                resolve(resolved.name);
            } catch (e) {
                reject(e);
            }
        })

    private pushContext = (currentDir: string): IBundlerContext => {
        const ctx: IBundlerContext = {
            currentDir,
            exports: [],
            defaultExport: null,
            hasImports: false
        };
        this.context.push(ctx);
        return ctx;
    }
    private popContext = () => this.context.pop();
    private getContext = () => this.context[this.context.length - 1];

    private formatExports = () => {
        if (this.getContext().defaultExport) {
            return `module.exports = ${this.getContext().defaultExport};`;
        }

        if (this.getContext().exports.length > 0) {
            return `module.exports = {${
                this.getContext().exports
                    .map(exp => exp.name + (exp.alias ? ': ' + exp.alias : ''))
                    .join(', ')
                }};`;
        }

        return '';
    }
}
