import * as path from 'path';
import * as prettier from 'prettier';

import { fileToSource } from './nodes';
import { Parser } from './parser';

export type IFileNameResolver = (currentDir: string, filename: string) => string;
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

const requireName = '__eco_require__';
const SKELETON_MODULE_SECTION = '%%%__MODULES__%%%';
const SKELETON_ENTRY_SECTION = '%%%__ENTRYPOINT__%%%';

// tslint:disable-next-line
const SKELETON = `((modules) => {const cachedModules = {};const ${requireName} = (moduleId) => {if (cachedModules[moduleId]) {return cachedModules[moduleId].exports;}const module = {exports: {}};cachedModules[moduleId] = module;modules[moduleId](module, ${requireName});return module.exports;};return __eco_require__("${SKELETON_ENTRY_SECTION}");})({${SKELETON_MODULE_SECTION}});`;

export class Bundler {
    constructor() {
        this.fileNameResolver = (currentDir, filename) => path.join(currentDir, filename);
    }

    private fileNameResolver: IFileNameResolver;
    private importResolver: IImportResolver;
    private context: IBundlerContext[] = [];
    private files: IBundlerFile[] = [];

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
                        params.push(requireName);
                    }

                    return `"${file.name}": (${params.join(', ')}) => {${file.content}}`;
                };

                const modules = this.files
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
                await this.bundleFile(this.getContext().currentDir, filename);
                resolve(`${requireName}('${this.fileNameResolver(ctx.currentDir, filename)}')`);
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

    private bundleFile = async (currentDir: string, fileName: string) => {
        this.pushContext(path.join(currentDir, path.dirname(fileName)));
        const ctx = this.getContext();

        const filePath = this.resolveFileName(this.getContext().currentDir, path.basename(fileName));
        const resolvedImport = await this.importResolver(filePath);
        const parser = new Parser(resolvedImport);
        const nodes = parser.parse();

        const content = await fileToSource(nodes, this) + this.formatExports();
        const hasImports = this.getContext().hasImports;
        const hasExports = ctx.defaultExport !== null || ctx.exports.length > 0;

        this.files.push({
            name: filePath,
            hasExports,
            hasImports,
            content
        });

        this.popContext();
    }

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
