import * as prettier from 'prettier';

import { ExpressionNode, fileToSource, statementListToSource } from './nodes';
import { Parser } from './parser';

export interface IResolvedImport {
    moduleId: string;
    content: string;
}
export type IImportResolver = (currentDir: string, filename: string) => Promise<IResolvedImport>;

export interface INamedExport {
    name: string;
    alias?: string;
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
    constructor() { } // tslint:disable-line

    private importResolver: IImportResolver;
    private context: IBundlerContext[] = [];
    private files: IBundlerFile[] = [];

    onResolveImport = (resolver: IImportResolver) => {
        this.importResolver = resolver;
    }

    bundle = (currentDir: string, fileName: string): Promise<string> =>
        new Promise(async (resolve, reject) => {
            try {
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
                    prettier.format(
                        output,
                        { parser: 'babel' }
                    )
                );
            } catch (e) {
                reject(e);
            }
        })

    handleSourceImport = (filename: string): Promise<string> =>
        new Promise(async (resolve, reject) => {
            try {
                this.getContext().hasImports = true;
                await this.bundleFile(this.getContext().currentDir, filename);
                resolve(`${requireName}('${filename}')`);
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

        this.pushContext(currentDir);
        const ctx = this.getContext();

        const resolvedImport = await this.importResolver(currentDir, fileName);
        const parser = new Parser(resolvedImport.content);
        const nodes = parser.parse();

        const content = await fileToSource(nodes, this) + this.formatExports();
        const hasImports = this.getContext().hasImports;

        this.files.push({
            name: fileName,
            hasExports: ctx.defaultExport !== null || ctx.exports.length > 0,
            hasImports,
            content
        });

        this.popContext();
    }

    private pushContext = (currentDir: string): IBundlerContext => {
        const ctx: IBundlerContext = { currentDir, exports: [], defaultExport: null, hasImports: false };
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
