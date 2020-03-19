import * as prettier from 'prettier';

import { statementListToSource } from './nodes';
import { Parser } from './parser';

export interface IResolvedImport {
    moduleId: string;
    content: string;
}
export type IImportResolver = (currentDir: string, filename: string) => IResolvedImport;

export interface INamedExport {
    name: string;
    alias?: string;
}

export interface IBundlerContext {
    exports: INamedExport[];
    defaultExport: string;
}

export class Bundler {
    constructor() {} // tslint:disable-line

    private importResolver: IImportResolver;
    private context: IBundlerContext[] = [];

    onResolveImport = (resolver: IImportResolver) => {
        this.importResolver = resolver;
    }

    bundle = (currentDir: string, fileName: string): string => {
        this.bundleFile(currentDir, fileName);

        return '';
    }

    handleSourceImport = (filename: string): string => {
        return `__eco_require__('${filename}')`;
    }

    addExport = (name: string, alias?: string) => {
        this.getContext().exports.push({ name, alias });
    }

    setDefaultExport = (defaultExport: string) => {
        this.getContext().defaultExport = defaultExport;
    }

    private bundleFile = (currentDir: string, fileName: string) => {

        this.pushContext();

        const resolvedImport = this.importResolver(currentDir, fileName);
        const parser = new Parser(resolvedImport.content);
        const nodes = parser.parse();

        const output = statementListToSource(nodes, this) + this.formatExports();
        console.log(prettier.format(output, { parser: 'babel' }));

        this.popContext();
    }

    private pushContext = () => this.context.push({ exports: [], defaultExport: null });
    private popContext = () => this.context.pop();
    private getContext = () => this.context[this.context.length - 1];

    private formatExports = () => {
        if (this.getContext().defaultExport) {
            return `module.exports = ${this.getContext().defaultExport};`;
        }

        return `module.exports = {${ this.getContext().exports.map(exp => exp.name + (exp.alias ? ': ' + exp.alias : '')).join(', ') }};`;
    }
}
