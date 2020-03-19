import { Dictionary, StringNullableChain } from 'lodash';

import { IOperatorType, IToken, ITokenType, Lexer, ParserError } from './lexer';
import {
    ArrayAccessNode,
    ArrayNode,
    AssignmentNode,
    BinaryOpNode,
    BlockNode,
    ErrorNode,
    ExportNode,
    ExpressionNode,
    FieldAccessNode,
    FuncCallNode,
    FunctionNode,
    HTMLExprNode,
    HTMLNode,
    HTMLTextNode,
    IDestructuredValue,
    IExportAsObject,
    IfNode,
    IImportObject,
    ImportNode,
    IncOrDecNode,
    IObjectDynamicField,
    IObjectFieldType,
    IObjectRegularField,
    IObjectSpreadField,
    IVariableNodeType,
    LiteralNode,
    LoadNode,
    MethodCallNode,
    NewNode,
    NoopNode,
    ObjectNode,
    ParenthesesNode,
    ParseNode,
    ReturnNode,
    SpreadNode,
    StatementNode,
    TemplateStringContentNode,
    TemplateStringNode,
    TernaryOpNode,
    ThrowNode,
    TryCatchNode,
    TypeofNode,
    UnaryOpNode,
    VarDeclNode,
    VariableNode,
    WhileNode
} from './nodes';
import { Runtime } from './runtime';

export class Parser {
    constructor(input: string) {
        this.lexer = new Lexer(input);
    }
    private lexer: Lexer;
    private blockDepth: number = 0;

    parseExpression = (): ParseNode => this.parseAssignment();

    parse = (): ParseNode[] => {
        const nodes: ParseNode[] = [];

        while (this.lexer.peek()) {
            nodes.push(this.parseStatement());
        }

        return nodes;
    }

    private parseStatement = (): StatementNode => {
        return this.lexer.switchTokenType({
            'const': () => this.parseVarDecl(true),
            'let': () => this.parseVarDecl(false),
            '{': () => this.parseBlock(),
            'if': () => this.parseIf(),
            'while': () => this.parseWhile(),
            'return': () => this.parseReturn(),
            'throw': () => this.parseThrow(),
            'try': () => this.parseTryCatch(),
            'import': () => this.parseImport(),
            'export': () => this.parseExport(),
            ';': () => {
                this.lexer.consume(';');
                return new NoopNode();
            }
        }, () => {
            const expression = this.parseExpression();
            this.lexer.consume(';');
            return expression;
        });
    }

    private parseImport = (): ImportNode => {
        if (this.blockDepth > 0) {
            throw new ParserError(this.lexer, this.lexer.getLastPosition(), 'Imports must be top level');
        }

        this.lexer.consume('import');
        const node = new ImportNode();

        if (this.lexer.peek('{')) {

            this.lexer.consume();
            const objects: IImportObject[] = [];

            if (!this.lexer.peek('}')) {
                const parseImportObject = () => {
                    const name = this.lexer.consume('identifier').value as string;

                    if (this.lexer.peek('as')) {
                        this.lexer.consume();
                        const alias = this.lexer.consume('identifier').value as string;

                        objects.push({
                            name,
                            alias
                        });
                    } else {
                        objects.push({
                            name
                        });
                    }
                };

                parseImportObject();

                while (this.lexer.peek(',')) {
                    this.lexer.consume();

                    parseImportObject();
                }
            }

            this.lexer.consume('}');

            node.objects = objects;
            this.lexer.consume('from');
            node.fromFile = this.lexer.consume('string').value;

        } else if (this.lexer.peekOperator('*')) {
            this.lexer.consume();
            this.lexer.consume('as');
            node.namespaceName = this.lexer.consume('identifier').value;
            this.lexer.consume('from');
            node.fromFile = this.lexer.consume('string').value;
        } else if (this.lexer.peek('identifier')) {
            node.defaultName = this.lexer.consume('identifier').value;
            this.lexer.consume('from');
            node.fromFile = this.lexer.consume('string').value;
        } else {
            node.fromFile = this.lexer.consume('string').value;
        }

        return node;
    }

    private parseExport = (): ExportNode => {
        if (this.blockDepth > 0) {
            throw new ParserError(this.lexer, this.lexer.getLastPosition(), 'Exports must be top level');
        }

        this.lexer.consume('export');

        const node = new ExportNode();

        if (this.lexer.peek('default')) {
            this.lexer.consume();

            node.defaultValue = this.parseExpression();
            this.lexer.consume(';');
        } else if (this.lexer.peek('{')) {
            this.lexer.consume();

            const namedExports: IExportAsObject[] = [];

            if (!this.lexer.peek('}')) {
                const parseNamedExport = () => {
                    if (this.lexer.peek('default')) {
                        this.lexer.consume();
                        this.lexer.consume('as');
                        const alias = this.lexer.consume('identifier').value as string;

                        namedExports.push({
                            defaultObject: true,
                            alias
                        });
                    } else {
                        const name = this.lexer.consume('identifier').value as string;
                        if (this.lexer.peek('as')) {
                            this.lexer.consume();
                            const alias = this.lexer.consume('identifier').value as string;

                            namedExports.push({
                                name,
                                alias
                            });
                        } else {
                            namedExports.push({
                                name
                            });
                        }
                    }
                };

                parseNamedExport();

                while (this.lexer.peek(',')) {
                    this.lexer.consume();

                    parseNamedExport();
                }
            }

            this.lexer.consume('}');
            this.lexer.consume('from');
            const fileName = this.lexer.consume('string').value as string;

            node.fromFile = {
                allExports: false,
                namedExports,
                fileName
            };
        } else if (this.lexer.peekOperator('*')) {
            this.lexer.consume();
            this.lexer.consume('from');
            const fileName = this.lexer.consume('string').value as string;

            node.fromFile = {
                allExports: true,
                namedExports: null,
                fileName
            };
        } else {
            node.varDeclNode = this.parseVarDecl(!!this.lexer.peek('const'));
        }

        return node;
    }

    private parseWhile = (): WhileNode => {
        const node = new WhileNode();

        this.lexer.consume('while');
        this.lexer.consume('(');
        node.condition = this.parseExpression();
        this.lexer.consume(')');

        node.loop = this.parseStatement();

        return node;
    }

    private parseIf = (): IfNode => {
        const node = new IfNode();

        this.lexer.consume('if');
        this.lexer.consume('(');
        node.condition = this.parseExpression();
        this.lexer.consume(')');

        node.thenStatement = this.parseStatement();

        if (this.lexer.peek('else')) {
            this.lexer.consume();

            node.elseStatement = this.parseStatement();
        }

        return node;
    }

    private parseTryCatch = (): TryCatchNode => {
        const node = new TryCatchNode();

        this.lexer.consume('try');
        node.tryBlock = this.parseBlock();

        this.lexer.consume('catch');
        if (this.lexer.peek('(')) {
            this.lexer.consume('(');
            node.catchErrorName = this.lexer.consume('identifier').value;
            this.lexer.consume(')');
        }

        node.catchBlock = this.parseBlock();

        if (this.lexer.peek('finally')) {
            this.lexer.consume('finally');
            node.finallyBlock = this.parseBlock();
        }

        return node;
    }

    private parseThrow = (): ThrowNode => {
        const node = new ThrowNode();

        this.lexer.consume('throw');
        node.value = this.parseExpression();

        return node;
    }

    private parseDestructuredValue = (isRest: boolean = false): IDestructuredValue => {
        const name = this.lexer.consume('identifier').value as string;
        let defaultValue: ExpressionNode;

        if (!isRest && this.lexer.peekOperator('=')) {
            this.lexer.consume();
            defaultValue = this.parseExpression();
        }

        return { name, defaultValue, isRest };
    }

    private parseVariable = (mustBeIdent: boolean = false): VariableNode => {
        const node = new VariableNode();

        const destructure = (type: IVariableNodeType, open: ITokenType, close: ITokenType) => {
            node.variableType = type;
            const values: IDestructuredValue[] = [];
            this.lexer.consume(open);

            let foundRest: IToken;

            const parseValue = () => {
                if (foundRest) {
                    throw new ParserError(this.lexer, foundRest.position, 'Cannot destructure more values after rest value');
                }

                if (this.lexer.peek('...')) {
                    foundRest = this.lexer.consume();
                }

                if (type === IVariableNodeType.DestructureArray) {
                    if (!this.lexer.peek(',')) {
                        values.push(this.parseDestructuredValue(!!foundRest));
                    } else {
                        values.push(null);
                    }
                } else {
                    values.push(this.parseDestructuredValue(!!foundRest));
                }
            };

            if (!this.lexer.peek(close)) {
                parseValue();

                while (this.lexer.peek(',')) {
                    this.lexer.consume();

                    parseValue();
                }
            }

            this.lexer.consume(close);
            node.left = values;
        };

        if (mustBeIdent) {
            node.variableType = IVariableNodeType.Identifier;
            node.left = this.lexer.consume('identifier').value as string;
        } else {
            if (this.lexer.peek('[')) {
                destructure(IVariableNodeType.DestructureArray, '[', ']');
            } else if (this.lexer.peek('{')) {
                destructure(IVariableNodeType.DestructureObject, '{', '}');
            } else {
                node.variableType = IVariableNodeType.Identifier;
                node.left = this.lexer.consume('identifier').value as string;
            }
        }

        if (this.lexer.peekOperator('=')) {
            this.lexer.consume();
            node.defaultValue = this.parseExpression();
        }

        return node;
    }

    private parseVarDecl = (isConst: boolean): VarDeclNode => {
        this.lexer.consume(isConst ? 'const' : 'let');

        const node = new VarDeclNode();
        node.isConst = isConst;
        node.variableNode = this.parseVariable();

        this.lexer.consume(';');

        return node;
    }

    private parseBlock = (): BlockNode => {
        const node = new BlockNode();

        this.lexer.consume('{');
        this.blockDepth++;

        while (!this.lexer.peek('}')) {
            node.statements.push(this.parseStatement());
        }

        this.blockDepth--;
        this.lexer.consume('}');

        return node;
    }

    private parseReturn = (): ReturnNode => {
        this.lexer.consume('return');

        const node = new ReturnNode();

        if (!this.lexer.peek(';')) {
            node.returnValue = this.parseExpression();
        }

        this.lexer.consume(';');

        return node;
    }

    private parseAssignment = (): BinaryOpNode | ParseNode => {
        const left = this.parseTernary();

        const validOperators: IOperatorType[] = [
            '=',
            '+=', '-=', '*=', '/='
        ];

        const op = this.lexer.peek();
        if (op && validOperators.includes(op.value as IOperatorType)) {
            this.lexer.consume();

            const right = this.parseTernary();

            return new AssignmentNode(left, op.value as IOperatorType, right);
        }

        return left;
    }

    private parseTernary = (): TernaryOpNode | ParseNode => {
        const node = this.parseBoolean();

        if (this.lexer.peek('?')) {
            this.lexer.consume();

            const ternaryNode = new TernaryOpNode();
            ternaryNode.condition = node;
            ternaryNode.thenExpr = this.parseExpression();

            this.lexer.consume(':');

            ternaryNode.elseExpr = this.parseExpression();

            return ternaryNode;
        }

        return node;
    }

    private parseBinaryExpression = (opts: {
        parseSubExpression: () => ParseNode,
        validOperators: Array<IOperatorType | ITokenType>,
    }): BinaryOpNode | ParseNode => {
        const left = opts.parseSubExpression();

        const op = this.lexer.peek();
        if (op && (
            opts.validOperators.includes(op.value as IOperatorType) ||
            opts.validOperators.includes(op.type as ITokenType)
        )) {
            this.lexer.consume();

            const right = opts.parseSubExpression();

            return new BinaryOpNode(left, op.value as IOperatorType, right);
        }

        return left;
    }

    private parseBoolean = (): BinaryOpNode | ParseNode =>
        this.parseBinaryExpression({
            parseSubExpression: () => this.parseEquality(),
            validOperators: ['&&', '||']
        })

    private parseEquality = (): BinaryOpNode | ParseNode =>
        this.parseBinaryExpression({
            parseSubExpression: () => this.parseArithmetic(),
            validOperators: [
                '===', '==',
                '!==', '!=',
                '>=', '<=',
                '>', '<'
            ]
        })

    private parseArithmetic = (): BinaryOpNode | ParseNode =>
        this.parseBinaryExpression({
            parseSubExpression: () => this.parseGeometric(),
            validOperators: ['+', '-']
        })

    private parseGeometric = (): BinaryOpNode | ParseNode =>
        this.parseBinaryExpression({
            parseSubExpression: () => this.parseUnary(),
            validOperators: ['*', '/']
        })

    private parseUnary = (): UnaryOpNode | ParseNode => {
        if (this.lexer.peekOperator('-') || this.lexer.peekOperator('!')) {
            return new UnaryOpNode(this.lexer.consume().value as IOperatorType, this.parseUnary());
        } else if (this.lexer.peekOperator('--') || this.lexer.peekOperator('++')) {
            return new IncOrDecNode(true, this.lexer.consume().value as IOperatorType, this.parsePostOp());
        }

        return this.parsePostOp();
    }

    private parsePostOp = (): ExpressionNode => {
        const expr = this.parseAccess();

        if (this.lexer.peekOperator('--') || this.lexer.peekOperator('++')) {
            return new IncOrDecNode(false, this.lexer.consume().value as IOperatorType, expr);
        }

        return expr;
    }

    private parseAccess = (): ArrayAccessNode | FieldAccessNode | FuncCallNode | ParseNode => {
        let object = this.parsePrimary();

        while (this.lexer.peek('[') || this.lexer.peek('.') || this.lexer.peek('(')) {
            if (this.lexer.peek('[')) {
                this.lexer.consume('[');
                const accessNode = new ArrayAccessNode();
                accessNode.object = object;
                accessNode.index = this.parseExpression();
                this.lexer.consume(']');

                object = accessNode;
            } else if (this.lexer.peek('.')) {
                this.lexer.consume('.');
                const fieldName = this.lexer.consume('identifier').value as string;

                if (this.lexer.peek('(')) {
                    const callNode = new MethodCallNode();
                    callNode.object = object;
                    callNode.fieldName = fieldName;

                    this.lexer.consume('(');

                    if (!this.lexer.peek(')')) {
                        callNode.args.push(this.parseExpression());

                        while (this.lexer.peek(',')) {
                            this.lexer.consume();

                            callNode.args.push(this.parseExpression());
                        }
                    }
                    this.lexer.consume(')');

                    object = callNode;
                } else {
                    const accessNode = new FieldAccessNode();
                    accessNode.object = object;
                    accessNode.field = fieldName;

                    object = accessNode;
                }
            } else if (this.lexer.peek('(')) {
                this.lexer.consume('(');

                const callNode = new FuncCallNode();
                callNode.object = object;

                if (!this.lexer.peek(')')) {
                    callNode.args.push(this.parseExpression());

                    while (this.lexer.peek(',')) {
                        this.lexer.consume();

                        callNode.args.push(this.parseExpression());
                    }
                }
                this.lexer.consume(')');

                object = callNode;
            }
        }

        return object;
    }

    private parsePrimary = (): ParseNode => {
        this.lexer.peek();
        const position = this.lexer.getLastPosition();

        try {
            const result = this.lexer.switchTokenType(
                {
                    'true': () => { this.lexer.consume(); return new LiteralNode(true); },
                    'false': () => { this.lexer.consume(); return new LiteralNode(false); },
                    'null': () => { this.lexer.consume(); return new LiteralNode(null); },
                    'undefined': () => { this.lexer.consume(); return new LiteralNode(undefined); },
                    'number': () => new LiteralNode(parseFloat(this.lexer.consume().value)),
                    'string': () => new LiteralNode(this.lexer.consume().value),
                    '(': () => this.parseParentheses(),
                    '[': () => this.parseArray(),
                    '{': () => this.parseObject(),
                    '<': () => this.parseHtml(),
                    '`': () => this.parseTemplateString(),
                    'new': () => this.parseNew(),
                    'typeof': () => this.parseTypeof(),
                    'identifier': () => this.parseLoad()
                },
                () => {
                    const errorToken = this.lexer.peek();
                    throw new ParserError(this.lexer, this.lexer.getPosition(), `Unexpected token${errorToken ? ` '${errorToken.type}'` : ''}`);
                }
            );

            if (this.lexer.peek('=>')) {
                this.lexer.revert(position);

                return this.parseFunction();
            }

            return result;
        } catch (e) {
            this.lexer.revert(position);
            return this.parseFunction();
        }
    }

    private parseLoad = (): LoadNode =>
        new LoadNode(this.lexer.consume().value)

    private parseTypeof = (): TypeofNode => {
        const node = new TypeofNode();

        this.lexer.consume('typeof');
        node.expr = this.parseExpression();

        return node;
    }

    private parseNew = (): NewNode => {
        const node = new NewNode();

        this.lexer.consume('new');

        node.className = this.lexer.consume('identifier').value;

        if (this.lexer.peek('(')) {
            this.lexer.consume('(');

            if (!this.lexer.peek(')')) {
                node.args.push(this.parseExpression());

                while (this.lexer.peek(',')) {
                    this.lexer.consume();

                    node.args.push(this.parseExpression());
                }
            }

            this.lexer.consume(')');
        }

        return node;
    }

    private parseFunction = (): FunctionNode => {
        const node = new FunctionNode();

        if (this.lexer.peek('(')) {
            this.lexer.consume('(');

            if (!this.lexer.peek(')')) {
                node.parameters.push(this.parseVariable());

                while (this.lexer.peek(',')) {
                    this.lexer.consume();

                    node.parameters.push(this.parseVariable());
                }
            }

            this.lexer.consume(')');
        } else {
            node.parameters.push(this.parseVariable(true));
        }

        this.lexer.consume('=>');

        this.blockDepth++;
        if (this.lexer.peek('{')) {
            node.body = this.parseBlock();
        } else {
            node.body = this.parseExpression();
        }
        this.blockDepth--;

        return node;
    }

    private parseParentheses = (): ParenthesesNode => {
        this.lexer.consume('(');
        const node = new ParenthesesNode(this.parseExpression());
        this.lexer.consume(')');

        return node;
    }

    private parseExpressionOrSpread = (): ExpressionNode => {
        if (this.lexer.peek('...')) {
            this.lexer.consume();

            return new SpreadNode(this.parseExpression());
        }

        return this.parseExpression();
    }

    private parseArray = (): ArrayNode => {
        const node = new ArrayNode();
        this.lexer.consume('[');

        if (!this.lexer.peek(']')) {
            node.elements.push(this.parseExpressionOrSpread());

            while (this.lexer.peek(',')) {
                this.lexer.consume();

                node.elements.push(this.parseExpressionOrSpread());
            }
        }

        this.lexer.consume(']');
        return node;
    }

    private parseObject = (): ObjectNode => {
        const node = new ObjectNode();
        this.lexer.consume('{');

        const parseKeyValuePair = () => {
            if (this.lexer.peek('...')) {
                this.lexer.consume();
                node.fields.push({
                    fieldType: IObjectFieldType.Spread,
                    data: {
                        value: this.parseExpression()
                    } as IObjectSpreadField
                });
            } else if (this.lexer.peek('[')) {
                this.lexer.consume();
                const key = this.parseExpression();
                this.lexer.consume(']');
                this.lexer.consume(':');
                const value = this.parseExpression();
                node.fields.push({
                    fieldType: IObjectFieldType.Dynamic,
                    data: {
                        key,
                        value
                    } as IObjectDynamicField
                });
            } else if (this.lexer.peek('string')) {
                const key = this.lexer.consume().value as string;
                this.lexer.consume(':');
                const value = this.parseExpression();
                node.fields.push({
                    fieldType: IObjectFieldType.Regular,
                    data: {
                        key,
                        value
                    } as IObjectRegularField
                });
            } else {
                const key = this.lexer.consume('identifier').value as string;

                if (this.lexer.peek(':')) {
                    this.lexer.consume(':');
                    const value = this.parseExpression();
                    node.fields.push({
                        fieldType: IObjectFieldType.Regular,
                        data: {
                            key,
                            value
                        } as IObjectRegularField
                    });
                } else {
                    node.fields.push({
                        fieldType: IObjectFieldType.Regular,
                        data: {
                            key,
                            value: undefined
                        } as IObjectRegularField
                    });
                }
            }
        };

        if (!this.lexer.peek('}')) {
            parseKeyValuePair();

            while (this.lexer.peek(',')) {
                this.lexer.consume();

                parseKeyValuePair();
            }
        }

        this.lexer.consume('}');
        return node;
    }

    private parseHtml = (): HTMLNode => {
        this.lexer.consume('<');
        const tagName: string =
            this.lexer.peek('identifier')
                ? this.lexer.consume('identifier').value
                : undefined;

        const node = new HTMLNode(tagName);
        if (tagName) {
            node.attributes = this.parseHtmlAttributes();
        }

        if (this.lexer.peek('/>')) {
            this.lexer.consume();
        } else {
            this.lexer.consume('>');

            node.children = this.parseHtmlChildren();

            this.lexer.consume('</');
            if (tagName) {
                this.lexer.consumeIdentifier(tagName);
            }
            this.lexer.consume('>');
        }

        return node;
    }

    private parseHtmlAttributes = (): Dictionary<ParseNode> => {
        const attributes: Dictionary<ParseNode> = {};

        while (this.lexer.peek('identifier')) {
            const name = this.lexer.consume().value;

            if (this.lexer.peekOperator('=')) {
                this.lexer.consumeOperator('=');

                if (this.lexer.peek('string')) {
                    attributes[name] = new LiteralNode(this.lexer.consume().value);
                } else {
                    this.lexer.consume('{');
                    attributes[name] = this.parseExpression();
                    this.lexer.consume('}');
                }
            } else {
                attributes[name] = new LiteralNode(true);
            }
        }

        return attributes;
    }

    private parseHtmlExpression = (): HTMLExprNode => {
        this.lexer.consume('{');
        const node = new HTMLExprNode(this.parseExpression());
        this.lexer.consume('}');

        return node;
    }

    private parseHtmlChildren = (): Array<HTMLNode | HTMLExprNode | HTMLTextNode> => {
        const children: Array<HTMLNode | HTMLExprNode | HTMLTextNode> = [];

        let textStart = this.lexer.getPosition();

        while (!this.lexer.peek('</')) {
            if (this.lexer.peek('<')) {
                children.push(this.parseHtml());
            } else if (this.lexer.peek('{')) {
                children.push(this.parseHtmlExpression());
            } else {
                const textToken = this.lexer.getUntil(['<', '</'], textStart);
                children.push(new HTMLTextNode(textToken.value));
            }

            textStart = this.lexer.getPosition();
        }

        return children;
    }

    private parseTemplateString = (): TemplateStringNode => {
        this.lexer.consume('`');

        const node = new TemplateStringNode();

        let textStart = this.lexer.getPosition();

        while (!this.lexer.peek('`')) {
            const peekedExpressionStart = this.lexer.peek('${');
            if (peekedExpressionStart && peekedExpressionStart.position === textStart) {
                this.lexer.consume('${');
                node.parts.push(this.parseExpression());
                this.lexer.consume('}');
            } else {
                const content = this.lexer.getUntil(['`', '${'], textStart);
                node.parts.push(new TemplateStringContentNode(content.value));
            }

            textStart = this.lexer.getPosition();
        }

        this.lexer.consume('`');

        return node;
    }
}

export const parseExpression = (input: string): ExpressionNode => {
    const parser = new Parser(input);
    try {
        return parser.parseExpression();
    } catch (e) {
        console.log(e);
        return new ErrorNode(e.message);
    }
};

export const evaluate = (input: string, runtime: Runtime) => {
    const parser = new Parser(input);
    const nodes = parser.parse();

    try {
        // Old-school for loop for efficiency
        for (let i = 0; i < nodes.length; i++) { // tslint:disable-line
            nodes[i].evaluate(runtime);
        }

    } catch (e) {
        console.log(e);
    }
};
