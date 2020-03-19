import { Dictionary } from 'lodash';

import { Bundler } from './bundler';
import { FuncClosure, ReturnValueException } from './closure';
import { HtmlElement } from './html';
import { IOperatorType, ITokenType } from './lexer';
import { parseExpression } from './parser';
import { Runtime } from './runtime';

export const fileToSource = (list: StatementNode[], bundler: Bundler) =>
    new Promise(async (resolve, reject) => {
        try {
            const importNodes = list.filter(item => item instanceof ImportNode) as ImportNode[];
            const otherNodes = list.filter(item => !(item instanceof ImportNode));

            let output = '';
            for (const importNode of importNodes) {
                output += await importNode.importToSource(bundler);
            }

            for (const otherNode of otherNodes) {
                if (otherNode instanceof ExportNode) {
                    output += await otherNode.exportToSource(bundler);
                } else {
                    output += otherNode.toSource(bundler) + (otherNode instanceof ExpressionNode ? ';' : '');
                }
            }

            resolve(output);
        } catch (e) {
            reject(e);
        }
    });

export const statementListToSource = (list: StatementNode[], bundler: Bundler): string =>
    list.map(item => item.toSource(bundler) + (item instanceof ExpressionNode ? ';' : '')).join('');

export const expressionListToSource = (list: ExpressionNode[], bundler: Bundler): string =>
    list.map(item => item.toSource(bundler)).join(', ');

export class ParseNode {
    evaluate = (runtime: Runtime): any => undefined;
    toSource = (bundler: Bundler): string => '';
}

export class ErrorNode extends ParseNode {
    constructor(public message: string) {
        super();
    }

    evaluate = (runtime: Runtime) => this.message;
}

export class StatementNode extends ParseNode {
    constructor() {
        super();
    }
}

export class NoopNode extends StatementNode {
}

export enum IVariableNodeType {
    Identifier,
    DestructureArray,
    DestructureObject
}

export interface IDestructuredValue {
    name: string;
    defaultValue?: ExpressionNode;
    isRest?: boolean;
}

export class VariableNode extends ParseNode {
    constructor() {
        super();
    }

    variableType: IVariableNodeType;
    left: string | Array<IDestructuredValue | null>;
    defaultValue: ExpressionNode;

    evaluate = (runtime: Runtime) => {
        if (this.defaultValue) {
            const defaultValue = runtime.evaluateNode(this.defaultValue);
            this.assignValue(runtime, defaultValue);
            return defaultValue;
        }
    }

    toSource = (bundler: Bundler): string => {
        const defaultValue = () =>
            this.defaultValue ? ` = ${this.defaultValue.toSource(bundler)}` : '';

        switch (this.variableType) {
            case IVariableNodeType.Identifier: {
                return (
                    `${
                    this.left as string
                    }${defaultValue()}`
                );
            }

            case IVariableNodeType.DestructureArray: {
                const vars = this.left as IDestructuredValue[];
                return (
                    `[${
                    vars.map(destructured => (
                        `${destructured.isRest ? '...' : ''}${destructured.name}${destructured.defaultValue ? ` = ${destructured.defaultValue.toSource(bundler)}` : ''}`
                    )).join(', ')
                    }]${defaultValue()}`
                );
            }

            case IVariableNodeType.DestructureObject: {
                const vars = this.left as IDestructuredValue[];

                return (
                    `{${
                    vars.map(destructured => (
                        `${destructured.isRest ? '...' : ''}${destructured.name}${destructured.defaultValue ? ` = ${destructured.defaultValue.toSource(bundler)}` : ''}`
                    )).join(', ')
                    }}${defaultValue()}`
                );
            }
        }
    }

    assignValue = (runtime: Runtime, value: any) => {
        switch (this.variableType) {
            case IVariableNodeType.Identifier: {
                runtime.getScope()[this.left as string] = value;
                break;
            }

            case IVariableNodeType.DestructureArray: {
                const vars = this.left as IDestructuredValue[];
                const values = value as any[];

                vars.forEach((destructuredVar, index) => {
                    if (destructuredVar) {
                        runtime.getScope()[destructuredVar.name] =
                            destructuredVar.isRest
                                ? values.slice(index)
                                : (
                                    values[index] === undefined
                                        ? (
                                            destructuredVar.defaultValue
                                            && runtime.evaluateNode(destructuredVar.defaultValue)
                                        )
                                        : values[index]
                                );
                    }
                });

                break;
            }

            case IVariableNodeType.DestructureObject: {
                const vars = this.left as IDestructuredValue[];
                const values = value as { [key: string]: any };

                vars.forEach(destructuredVar => {
                    runtime.getScope()[destructuredVar.name] =
                        destructuredVar.isRest
                            ? (
                                Object.keys(values)
                                    .filter(key => !vars.find(dvar => dvar.name === key))
                                    .reduce((cur, key) => ({
                                        ...cur,
                                        [key]: values[key]
                                    }), {})
                            )
                            : (
                                values[destructuredVar.name] === undefined
                                    ? (
                                        destructuredVar.defaultValue
                                        && runtime.evaluateNode(destructuredVar.defaultValue)
                                    )
                                    : values[destructuredVar.name]
                            );
                });

                break;
            }
        }
    }
}

export class VarDeclNode extends StatementNode {
    constructor() {
        super();
    }

    variableNode: VariableNode;
    isConst: boolean;

    evaluate = (runtime: Runtime) => runtime.evaluateNode(this.variableNode);

    toSource = (bundler: Bundler): string => {
        const keyword = this.isConst ? 'const' : 'let';

        return `${keyword} ${this.variableNode.toSource(bundler)};`;
    }
}

export interface IExportAsObject {
    name?: string;
    defaultObject?: boolean;
    alias?: string;
}

export class ExportNode extends StatementNode {
    constructor() {
        super();
    }

    defaultValue: ExpressionNode;
    varDeclNode: VarDeclNode;
    fromFile: {
        fileName: string;
        allExports: boolean;
        namedExports: IExportAsObject[];
    };

    exportToSource = async (bundler: Bundler): Promise<string> =>
        new Promise(async (resolve, reject) => {
            try {
                if (this.defaultValue) {
                    bundler.setDefaultExport(this.defaultValue.toSource(bundler));
                    resolve('');
                    return;
                }

                if (this.varDeclNode) {
                    const varNode = this.varDeclNode.variableNode;

                    if (typeof varNode.left === 'string') {
                        bundler.addExport(varNode.left);
                    } else {
                        varNode.left.forEach(destructured => {
                            bundler.addExport(destructured.name);
                        });
                    }
                    resolve(this.varDeclNode.toSource(bundler));
                    return;
                }

                if (this.fromFile) {
                    const imp = await bundler.handleSourceImport(this.fromFile.fileName);

                    if (this.fromFile.allExports) {
                        bundler.setDefaultExport(imp);
                        resolve('');
                        return;
                    }

                    this.fromFile.namedExports.forEach(exp => bundler.addExport(exp.name, exp.alias));
                    resolve(`const {${this.fromFile.namedExports.map(exp => exp.name).join(', ')}} = ${imp};`);
                }
            } catch (e) {
                reject(e);
            }
        })
}

export interface IImportObject {
    name: string;
    alias?: string;
}

export class ImportNode extends StatementNode {
    constructor() {
        super();
    }

    defaultName: string;
    namespaceName: string;
    objects: IImportObject[];
    fromFile: string;

    importToSource = (bundler: Bundler): Promise<string> =>
        new Promise(async (resolve, reject) => {
            try {
                const imp = await bundler.handleSourceImport(this.fromFile);

                if (this.defaultName) {
                    resolve(`const ${this.defaultName} = ${imp};`);
                    return;
                }

                if (this.namespaceName) {
                    resolve(`const ${this.namespaceName} = ${imp};`);
                    return;
                }

                if (this.objects) {
                    const aliases: Dictionary<string> = {};

                    const result = `const {${
                        this.objects.map(obj => {
                            if (obj.alias) {
                                aliases[obj.name] = obj.alias;
                            }
                            return obj.name;
                        }).join(', ')
                        }} = ${imp};`;

                    const aliasSource = Object.keys(aliases)
                        .reduce((cur, key) => cur + `const ${aliases[key]} = ${key};`, '');

                    resolve(result + aliasSource);
                }
            } catch (e) {
                reject(e);
            }
        })
}

export class BlockNode extends StatementNode {
    constructor() {
        super();
    }

    statements: StatementNode[] = [];

    evaluate = (runtime: Runtime) => {
        runtime.pushScope();

        // Old-school for loop for efficiency
        for (let i = 0; i < this.statements.length; i++) { // tslint:disable-line
            try {
                runtime.evaluateNode(this.statements[i]);
            } catch (e) {
                if (e instanceof ReturnValueException) {
                    runtime.popScope();
                    throw e;
                } else {
                    throw e;
                }
            }
        }

        runtime.popScope();
    }

    toSource = (bundler: Bundler): string =>
        `{${statementListToSource(this.statements, bundler)}}`
}

export class ReturnNode extends StatementNode {
    constructor() {
        super();
    }

    returnValue: ExpressionNode;

    evaluate = (runtime: Runtime) => {
        throw new ReturnValueException(
            this.returnValue
                ? runtime.evaluateNode(this.returnValue)
                : undefined
        );
    }

    toSource = (bundler: Bundler): string =>
        `return${this.returnValue ? ` ${this.returnValue.toSource(bundler)}` : ''};`
}

export class IfNode extends StatementNode {
    constructor() {
        super();
    }

    condition: ExpressionNode;
    thenStatement: StatementNode;
    elseStatement?: StatementNode;

    evaluate = (runtime: Runtime) => {
        if (runtime.evaluateNode(this.condition)) {
            runtime.evaluateNode(this.thenStatement);
        } else if (this.elseStatement) {
            runtime.evaluateNode(this.elseStatement);
        }
    }

    toSource = (bundler: Bundler): string =>
        `if (${
        this.condition.toSource(bundler)
        }) ${
        this.thenStatement.toSource(bundler)
        }${
        this.elseStatement
            ? ` else ${this.elseStatement.toSource(bundler)}`
            : ''
        }`
}

export class WhileNode extends StatementNode {
    constructor() {
        super();
    }

    condition: ExpressionNode;
    loop: StatementNode;

    evaluate = (runtime: Runtime) => {
        while (runtime.evaluateNode(this.condition)) {
            runtime.evaluateNode(this.loop);
        }
    }

    toSource = (bundler: Bundler): string =>
        `while (${this.condition.toSource(bundler)}) ${this.loop.toSource(bundler)}`
}

export class ThrowNode extends StatementNode {
    constructor() {
        super();
    }

    value: ExpressionNode;

    evaluate = (runtime: Runtime) => {
        throw runtime.evaluateNode(this.value);
    }

    toSource = (bundler: Bundler): string =>
        `throw ${this.value.toSource(bundler)}`
}

export class TryCatchNode extends StatementNode {
    constructor() {
        super();
    }

    tryBlock: BlockNode;
    catchBlock: BlockNode;
    finallyBlock?: BlockNode;

    catchErrorName?: string;

    evaluate = (runtime: Runtime) => {
        const evaluateCatch = (e: any) => {
            if (this.catchErrorName) {
                runtime.pushScope({
                    [this.catchErrorName]: e
                });

                runtime.evaluateNode(this.catchBlock);

                runtime.popScope();
            } else {
                runtime.evaluateNode(this.catchBlock);
            }
        };

        if (this.finallyBlock) {
            try {
                runtime.evaluateNode(this.tryBlock);
            } catch (e) {
                evaluateCatch(e);
            } finally {
                runtime.evaluateNode(this.finallyBlock);
            }
        } else {
            try {
                runtime.evaluateNode(this.tryBlock);
            } catch (e) {
                evaluateCatch(e);
            }
        }
    }

    toSource = (bundler: Bundler): string =>
        `try ${
        this.tryBlock.toSource(bundler)
        } catch${
        this.catchErrorName
            ? ` (${this.catchErrorName})`
            : ''
        } ${
        this.catchBlock.toSource(bundler)
        }${
        this.finallyBlock
            ? ` finally ${this.finallyBlock.toSource(bundler)}`
            : ''
        }`
}

export class ExpressionNode extends StatementNode {
    constructor() {
        super();
    }
}

export class LiteralNode extends ExpressionNode {
    constructor(public literalValue: any) {
        super();
    }

    evaluate = (runtime: Runtime) =>
        typeof this.literalValue === 'string' && this.literalValue.includes('#{')
            ? this.interpolate(this.literalValue, runtime)
            : this.literalValue

    toSource = (bundler: Bundler): string =>
        typeof this.literalValue === 'string'
            ? `'${this.literalValue}'`
            : `${this.literalValue}`

    private interpolate = (input: string, runtime: Runtime) =>
        input.replace(
            /#{([^{}]*)}/g,
            (_, subExpression) => `${runtime.evaluateNode(parseExpression(subExpression))}`,
        )
}

export class LoadNode extends ExpressionNode {
    constructor(public varName: string) {
        super();
    }

    evaluate = (runtime: Runtime) => runtime.getLocal(this.varName);

    toSource = (bundler: Bundler): string => this.varName;
}

export class ParenthesesNode extends ExpressionNode {
    constructor(public expression: ExpressionNode) {
        super();
    }

    evaluate = (runtime: Runtime) => runtime.evaluateNode(this.expression);

    toSource = (bundler: Bundler): string => `(${this.expression.toSource(bundler)})`;
}

export class SpreadNode extends ExpressionNode {
    constructor(public value: ExpressionNode) {
        super();
    }

    evaluate = (runtime: Runtime) => runtime.evaluateNode(this.value);

    toSource = (bundler: Bundler) => `...${this.value.toSource(bundler)}`;
}

export class ArrayNode extends ExpressionNode {
    constructor() {
        super();
    }
    elements: ExpressionNode[] = [];

    evaluate = (runtime: Runtime) => {
        let values = [];

        this.elements.forEach(element => {
            if (element instanceof SpreadNode) {
                values = [...values, ...runtime.evaluateNode(element)];
            } else {
                values.push(runtime.evaluateNode(element));
            }
        });

        return values;
    }

    toSource = (bundler: Bundler) =>
        `[${this.elements.map(element => element.toSource(bundler)).join(', ')}]`
}

export enum IObjectFieldType {
    Regular,
    Dynamic,
    Spread
}

export interface IObjectRegularField {
    key: string;
    value: ExpressionNode;
}

export interface IObjectDynamicField {
    key: ExpressionNode;
    value: ExpressionNode;
}

export interface IObjectSpreadField {
    value: ExpressionNode;
}

export interface IObjectField {
    fieldType: IObjectFieldType;
    data: IObjectRegularField | IObjectDynamicField | IObjectSpreadField;
}

export class ObjectNode extends ExpressionNode {
    constructor() {
        super();
    }
    fields: IObjectField[] = [];

    evaluate = (runtime: Runtime) => {
        let obj = {};

        this.fields.forEach(field => {
            switch (field.fieldType) {
                case IObjectFieldType.Regular: {
                    const key = (field.data as IObjectRegularField).key;
                    obj[key] = field.data.value ? runtime.evaluateNode(field.data.value) : runtime.getLocal(key);
                    break;
                }

                case IObjectFieldType.Dynamic: {
                    obj[runtime.evaluateNode(
                        (field.data as IObjectDynamicField).key)
                    ] = runtime.evaluateNode(field.data.value);
                    break;
                }

                case IObjectFieldType.Spread: {
                    obj = { ...obj, ...runtime.evaluateNode(field.data.value) };
                    break;
                }
            }
        });

        return obj;
    }

    toSource = (bundler: Bundler): string => {
        const defaultValue = (field: IObjectField) => field.data.value ? `: ${field.data.value.toSource(bundler)}` : '';
        return (
            `{${
            this.fields.map(field => (
                field.fieldType === IObjectFieldType.Regular
                    ? (
                        `${
                        typeof (field.data as IObjectRegularField).key === 'string'
                            ? `'${(field.data as IObjectRegularField).key}'`
                            : (field.data as IObjectRegularField).key
                        }${defaultValue(field)}`
                    ) : (
                        field.fieldType === IObjectFieldType.Dynamic
                            ? `[${(field.data as IObjectDynamicField).key.toSource(bundler)}]${defaultValue(field)}`
                            : `...${(field.data.value.toSource(bundler))}`
                    )
            ))
            }}`
        );
    }
}

export class FunctionNode extends ExpressionNode {
    constructor() {
        super();
    }

    parameters: VariableNode[] = [];
    body: StatementNode;

    evaluate = (runtime: Runtime) => this.generateClosure(runtime).func;

    toSource = (bundler: Bundler) =>
        `(${this.parameters.map(param => param.toSource(bundler)).join(', ')}) => ${this.body.toSource(bundler)}`

    protected generateClosure = (runtime: Runtime): FuncClosure => {
        const closure = new FuncClosure();
        closure.funcExpr = this;

        closure.runtime = runtime;
        closure.scope = runtime.getFullScope();

        const _this = this; // tslint:disable-line
        closure.func = (...funcArgs) => {

            closure.runtime.pushStack(closure);

            closure.runtime.pushScope(closure.scope);
            _this.marshallArgs(closure.runtime, closure.funcExpr.parameters, funcArgs);

            let returnValue;

            try {
                returnValue = (_this.body as StatementNode).evaluate(closure.runtime);
            } catch (e) {
                if (e instanceof ReturnValueException) {
                    closure.runtime.popScope();
                    closure.runtime.popScope();

                    closure.runtime.popStack();

                    return e.value;
                } else {
                    throw e;
                }
            }

            closure.runtime.popScope();
            closure.runtime.popScope();

            closure.runtime.popStack();

            return returnValue;
        };

        return closure;
    }

    private marshallArgs = (runtime: Runtime, params: VariableNode[], args: any[]) => {
        runtime.pushScope({});

        params.forEach((paramNode, index) => {
            paramNode.assignValue(
                runtime,
                args[index] !== undefined
                    ? args[index]
                    : paramNode.defaultValue && runtime.evaluateNode(paramNode.defaultValue)
            );
        });
    }
}

export class UnaryOpNode extends ExpressionNode {
    constructor(public opType: IOperatorType, public expr: ExpressionNode) {
        super();
    }

    evaluate = (runtime: Runtime) => {
        switch (this.opType) {
            case '!': return !runtime.evaluateNode(this.expr);
            case '-': return -runtime.evaluateNode(this.expr);
        }
    }

    toSource = (bundler: Bundler) => `${this.opType}${this.expr.toSource(bundler)}`;
}

export class IncOrDecNode extends ExpressionNode {
    constructor(public preOp: boolean, public opType: IOperatorType, public expr: ExpressionNode) {
        super();
    }

    evaluate = (runtime: Runtime) => {
        switch (this.opType) {
            case '--': {
                if (this.expr instanceof LoadNode) {
                    const cur = runtime.getLocal(this.expr.varName);
                    runtime.setLocal(this.expr.varName, cur - 1);
                    return this.preOp ? cur - 1 : cur;
                } else if (this.expr instanceof ArrayAccessNode) {
                    const obj = runtime.evaluateNode(this.expr.object);
                    const index = runtime.evaluateNode(this.expr.index);

                    return this.preOp ? --obj[index] : obj[index]--;
                } else if (this.expr instanceof FieldAccessNode) {
                    const obj = runtime.evaluateNode(this.expr.object);

                    return this.preOp ? --obj[this.expr.field] : obj[this.expr.field]--;
                } else {
                    throw new Error('Illegal assignment');
                }
            }

            case '++': {
                if (this.expr instanceof LoadNode) {
                    const cur = runtime.getLocal(this.expr.varName);
                    runtime.setLocal(this.expr.varName, cur + 1);
                    return this.preOp ? cur + 1 : cur;
                } else if (this.expr instanceof ArrayAccessNode) {
                    const obj = runtime.evaluateNode(this.expr.object);
                    const index = runtime.evaluateNode(this.expr.index);

                    return this.preOp ? ++obj[index] : obj[index]++;
                } else if (this.expr instanceof FieldAccessNode) {
                    const obj = runtime.evaluateNode(this.expr.object);

                    return this.preOp ? ++obj[this.expr.field] : obj[this.expr.field]++;
                } else {
                    throw new Error('Illegal assignment');
                }
            }
        }
    }

    toSource = (bundler: Bundler) =>
        this.preOp
            ? this.opType + this.expr.toSource(bundler)
            : this.expr.toSource(bundler) + this.opType
}

export class BinaryOpNode extends ExpressionNode {
    constructor(public left: ExpressionNode, public opType: IOperatorType | ITokenType, public right: ExpressionNode) {
        super();
    }

    evaluate = (runtime: Runtime) => {
        switch (this.opType) {
            case '&&': return runtime.evaluateNode(this.left) && runtime.evaluateNode(this.right);
            case '||': return runtime.evaluateNode(this.left) || runtime.evaluateNode(this.right);

            case '===': return runtime.evaluateNode(this.left) === runtime.evaluateNode(this.right);
            case '==': return runtime.evaluateNode(this.left) == runtime.evaluateNode(this.right); // tslint:disable-line

            case '!==': return runtime.evaluateNode(this.left) !== runtime.evaluateNode(this.right); // tslint:disable-line
            case '!=': return runtime.evaluateNode(this.left) != runtime.evaluateNode(this.right); // tslint:disable-line

            case '>': return runtime.evaluateNode(this.left) > runtime.evaluateNode(this.right);
            case '>=': return runtime.evaluateNode(this.left) >= runtime.evaluateNode(this.right);
            case '<': return runtime.evaluateNode(this.left) < runtime.evaluateNode(this.right);
            case '<=': return runtime.evaluateNode(this.left) <= runtime.evaluateNode(this.right);

            case '*': return runtime.evaluateNode(this.left) * runtime.evaluateNode(this.right);
            case '/': return runtime.evaluateNode(this.left) / runtime.evaluateNode(this.right);

            case '+': return runtime.evaluateNode(this.left) + runtime.evaluateNode(this.right);
            case '-': return runtime.evaluateNode(this.left) - runtime.evaluateNode(this.right);
        }
    }

    toSource = (bundler: Bundler): string =>
        `${this.left.toSource(bundler)} ${this.opType} ${this.right.toSource(bundler)}`
}

export class AssignmentNode extends BinaryOpNode {
    evaluate = (runtime: Runtime) => {
        switch (this.opType) {
            case '=': {
                if (this.left instanceof LoadNode) {
                    runtime.setLocal(this.left.varName, runtime.evaluateNode(this.right));
                } else if (this.left instanceof ArrayAccessNode) {
                    runtime.evaluateNode(this.left.object)[
                        runtime.evaluateNode(this.left.index)
                    ] = runtime.evaluateNode(this.right);
                } else if (this.left instanceof FieldAccessNode) {
                    runtime.evaluateNode(this.left.object)[this.left.field] = runtime.evaluateNode(this.right);
                } else {
                    throw new Error('Assignment failed');
                }

                break;
            }

            case '+=': {
                if (this.left instanceof LoadNode) {
                    runtime.setLocal(
                        this.left.varName,
                        runtime.getLocal(this.left.varName) + runtime.evaluateNode(this.right)
                    );
                } else if (this.left instanceof ArrayAccessNode) {
                    runtime.evaluateNode(this.left.object)[
                        runtime.evaluateNode(this.left.index)
                    ] += runtime.evaluateNode(this.right);
                } else if (this.left instanceof FieldAccessNode) {
                    runtime.evaluateNode(this.left.object)[this.left.field] += runtime.evaluateNode(this.right);
                } else {
                    throw new Error('Assignment failed');
                }

                break;
            }

            case '-=': {
                if (this.left instanceof LoadNode) {
                    runtime.setLocal(
                        this.left.varName,
                        runtime.getLocal(this.left.varName) - runtime.evaluateNode(this.right)
                    );
                } else if (this.left instanceof ArrayAccessNode) {
                    runtime.evaluateNode(this.left.object)[
                        runtime.evaluateNode(this.left.index)
                    ] -= runtime.evaluateNode(this.right);
                } else if (this.left instanceof FieldAccessNode) {
                    runtime.evaluateNode(this.left.object)[this.left.field] -= runtime.evaluateNode(this.right);
                } else {
                    throw new Error('Assignment failed');
                }

                break;
            }

            case '*=': {
                if (this.left instanceof LoadNode) {
                    runtime.setLocal(
                        this.left.varName,
                        runtime.getLocal(this.left.varName) * runtime.evaluateNode(this.right)
                    );
                } else if (this.left instanceof ArrayAccessNode) {
                    runtime.evaluateNode(this.left.object)[
                        runtime.evaluateNode(this.left.index)
                    ] *= runtime.evaluateNode(this.right);
                } else if (this.left instanceof FieldAccessNode) {
                    runtime.evaluateNode(this.left.object)[this.left.field] *= runtime.evaluateNode(this.right);
                } else {
                    throw new Error('Assignment failed');
                }

                break;
            }

            case '/=': {
                if (this.left instanceof LoadNode) {
                    runtime.setLocal(
                        this.left.varName,
                        runtime.getLocal(this.left.varName) / runtime.evaluateNode(this.right)
                    );
                } else if (this.left instanceof ArrayAccessNode) {
                    runtime.evaluateNode(this.left.object)[
                        runtime.evaluateNode(this.left.index)
                    ] /= runtime.evaluateNode(this.right);
                } else if (this.left instanceof FieldAccessNode) {
                    runtime.evaluateNode(this.left.object)[this.left.field] /= runtime.evaluateNode(this.right);
                } else {
                    throw new Error('Assignment failed');
                }

                break;
            }
        }
    }
}

export class TernaryOpNode extends ExpressionNode {
    constructor() {
        super();
    }
    condition: ExpressionNode;
    thenExpr: ExpressionNode;
    elseExpr: ExpressionNode;

    evaluate = (runtime: Runtime) =>
        runtime.evaluateNode(this.condition)
            ? runtime.evaluateNode(this.thenExpr)
            : runtime.evaluateNode(this.elseExpr)

    toSource = (bundler: Bundler) =>
        `${this.condition.toSource(bundler)} ? ${this.thenExpr.toSource(bundler)} : ${this.elseExpr.toSource(bundler)}`
}

export class ArrayAccessNode extends ExpressionNode {
    constructor() {
        super();
    }
    object: ExpressionNode;
    index: ExpressionNode;

    evaluate = (runtime: Runtime) =>
        runtime.evaluateNode(this.object)[runtime.evaluateNode(this.index)]

    toSource = (bundler: Bundler) =>
        `${this.object.toSource(bundler)}[${this.index.toSource(bundler)}]`
}

export class FieldAccessNode extends ExpressionNode {
    constructor() {
        super();
    }
    object: ExpressionNode;
    field: string;

    evaluate = (runtime: Runtime) =>
        runtime.evaluateNode(this.object)[this.field]

    toSource = (bundler: Bundler): string =>
        `${this.object.toSource(bundler)}.${this.field}`
}

export class FuncCallNode extends ExpressionNode {
    constructor() {
        super();
    }
    object: ExpressionNode;
    args: ExpressionNode[] = [];

    evaluate = (runtime: Runtime) => {
        const obj = runtime.evaluateNode(this.object);
        const args = this.args.map(arg => runtime.evaluateNode(arg));

        return obj.apply(runtime.global, args);
    }

    toSource = (bundler: Bundler): string =>
        `${this.object.toSource(bundler)}(${expressionListToSource(this.args, bundler)})`
}

export class MethodCallNode extends ExpressionNode {
    constructor() {
        super();
    }

    object: ExpressionNode;
    fieldName: string;
    args: ExpressionNode[] = [];

    evaluate = (runtime: Runtime) => {
        const obj = runtime.evaluateNode(this.object);
        const args = this.args.map(arg => runtime.evaluateNode(arg));

        return obj[this.fieldName].apply(obj, args);
    }

    toSource = (bundler: Bundler): string =>
        `${this.object.toSource(bundler)}.${this.fieldName}(${expressionListToSource(this.args, bundler)})`
}

export class NewNode extends ExpressionNode {
    constructor() {
        super();
    }

    className: string;
    args: ExpressionNode[] = [];

    evaluate = (runtime: Runtime) =>
        runtime.instantiate(this.className, this.args.map(arg => runtime.evaluateNode(arg)))

    toSource = (bundler: Bundler): string =>
        `new ${this.className}(${expressionListToSource(this.args, bundler)})`
}

export class TypeofNode extends ExpressionNode {
    constructor() {
        super();
    }

    expr: ExpressionNode;

    evaluate = (runtime: Runtime) => typeof runtime.evaluateNode(this.expr);

    toSource = (bundler: Bundler): string =>
        `typeof ${this.expr.toSource(bundler)}`
}

export class HTMLNode extends ExpressionNode {
    constructor(public tagName: string) {
        super();
    }
    attributes: Dictionary<ExpressionNode> = {};
    children: Array<HTMLNode | HTMLExprNode | HTMLTextNode> = [];

    evaluate = (runtime: Runtime) => {

        const attributes = Object.keys(this.attributes).reduce((obj, key) => {
            const value = runtime.evaluateNode(this.attributes[key]);

            return {
                ...obj,
                [key]: value
            };
        }, {});

        const children = this.children
            .map(child => runtime.evaluateNode(child))
            .filter(child => !!child);

        const component = runtime.getLocal(this.tagName);

        if (typeof component === 'function') {
            return new HtmlElement(component, attributes, children);
        }

        return new HtmlElement(this.tagName, attributes, children);
    }

    toSource = (bundler: Bundler): string => {
        const attributes = Object.keys(this.attributes).map(key => `${key}=${
            this.attributes[key] instanceof LiteralNode && typeof this.attributes[key].literalValue === 'string'
                ? `"${this.attributes[key].literalValue}"`
                : `{${this.attributes[key].toSource(bundler)}}`
            }`).join(' ');

        if (this.children.length === 0) {
            return `<${this.tagName} ${attributes} />`;
        } else {
            return `<${this.tagName} ${attributes}>${this.children.map(child => child.toSource(bundler)).join('')}</${this.tagName}>`;
        }
    }
}

export class HTMLExprNode extends ExpressionNode {
    constructor(public expr: ExpressionNode) {
        super();
    }

    evaluate = (runtime: Runtime) => runtime.evaluateNode(this.expr);

    toSource = (bundler: Bundler): string => `{${this.expr.toSource(bundler)}}`;
}

export class HTMLTextNode extends ExpressionNode {
    constructor(public text: string) {
        super();
    }

    evaluate = (runtime: Runtime) => this.text;

    toSource = (bundler: Bundler): string => this.text;
}

export class TemplateStringNode extends ExpressionNode {
    constructor() {
        super();
    }
    parts: ExpressionNode[] = [];

    evaluate = (runtime: Runtime) => this.parts.map(part => runtime.evaluateNode(part)).join('');

    toSource = (bundler: Bundler): string => '`' + this.parts.map(part => (
        part instanceof TemplateStringContentNode
            ? part.toSource(bundler)
            : `\${${part.toSource(bundler)}}`
    )).join('') + '`'
}

export class TemplateStringContentNode extends ExpressionNode {
    constructor(public content: string) {
        super();
    }

    evaluate = (runtime: Runtime) => this.content;

    toSource = (bundler: Bundler): string => this.content;
}
