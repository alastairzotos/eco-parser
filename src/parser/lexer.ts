export class ParserError extends Error {
    constructor(lexer: Lexer, position: number, message: string) {
        const location = lexer.getLineAndColumnFromPosition(position);

        super(`Error at line ${location.line}, column ${location.column}: ${message}`);
    }
}

const symbols = [
    '=>', '...',
    '`', '${',
    '</', '/>',
    '<', '>',
    '(', ')',
    '[', ']',
    '{', '}',
    ',', '.',
    '?', ':',
    ';'
] as const;

const keywordValues = {
    true: true,
    false: false,
    null: null,
    undefined
};

const operators = [
    '+=', '-=', '*=', '/=',
    '++', '--',
    '&&', '||',
    '===', '==', '=',
    '!==', '!=',
    '>=', '<=',
    '+', '-',
    '*', '/',
    '!',
] as const;

const keywords = [
    'const', 'let',
    'return',
    'new',
    'if', 'else',
    'while',
    'try', 'catch', 'finally', 'throw',
    'typeof',
    'export', 'default', 'expose',
    'import', 'from', 'as'
] as const;

export type ITokenType =
    (
        'singleComment' |
        'multiComment' |
        'identifier' |
        'integer' |
        'float' |
        'number' |
        'stringSingleQuote' |
        'stringDoubleQuote' |
        'string' |
        'operator'
    ) |
    typeof symbols[number] |
    typeof keywords[number] |
    keyof typeof keywordValues;

export type IOperatorType = typeof operators[number];

export interface IToken {
    type: ITokenType;
    value: any;
    position: number;
}

const isAlpha = (cur: string) =>
    (cur >= 'a' && cur <= 'z') ||
    (cur >= 'A' && cur <= 'Z') ||
    cur === '_';

const isDigit = (cur: string) =>
    cur >= '0' && cur <= '9';

const isWhite = (cur: string) =>
    cur === ' ' ||
    cur === '\t' ||
    cur === '\n';

export class Lexer {
    constructor(input: string) {
        this.input = input + ' ';
    }

    input: string;

    private lastPeekedToken: IToken | null = null;

    private currentPosition = 0;
    private lastPosition = 0;

    getPosition = () => this.currentPosition;
    getLastPosition = () => this.lastPosition;

    revert = (position: number) => {
        this.lastPeekedToken = null;
        this.currentPosition = position;
    }

    peek = (type?: ITokenType): IToken | null => {
        if (!this.lastPeekedToken) {
            this.lastPeekedToken = this.next();
        }

        if (type && (!this.lastPeekedToken || this.lastPeekedToken.type !== type)) {
            return null;
        }

        return this.lastPeekedToken;
    }

    peekOperator = (opType: IOperatorType): IToken | null => {
        const token = this.peek('operator');
        return token && token.value === opType ? token : null;
    }

    consume = (type?: ITokenType): IToken => {
        const token = this.lastPeekedToken || this.next();
        this.lastPeekedToken = null;

        if (type && (!token || token.type !== type)) {
            throw new ParserError(this, token ? token.position : this.currentPosition, `Expected '${type}', got ${token ? `'${token.type}'` : 'end of string'}`);
        }

        return token;
    }

    consumeOperator = (opType: IOperatorType): IToken => {
        const token = this.consume('operator');
        if (!token || token.value !== opType) {
            throw new ParserError(this, token ? token.position : this.currentPosition, `Expected '${opType}'`);
        }

        return token;
    }

    consumeIdentifier = (ident: string): IToken => {
        const token = this.consume('identifier');
        if (!token || token.value !== ident) {
            throw new ParserError(this, token ? token.position : this.currentPosition, `Expected '${ident}'`);
        }

        return token;
    }

    switchTokenType = (
        cases: Partial<Record<ITokenType, () => any>>,
        defaultCase?: () => any,
    ) => {
        const token = this.peek();

        return (
            token && token.type in cases
                ? cases[token.type as ITokenType]()
                : defaultCase ? defaultCase() : null
        );
    }

    getUntil = (close: string[], from?: number): IToken => {
        if (from) {
            this.currentPosition = from;
        }

        const position = this.currentPosition;
        let curToken = '';

        this.lastPeekedToken = null;

        for (; this.currentPosition < this.input.length; this.currentPosition++) {
            if (close.find(closer => this.input.substr(this.currentPosition, closer.length) === closer)) {
                return {
                    type: 'string',
                    value: curToken,
                    position,
                };
            }

            curToken += this.input[this.currentPosition];
        }

        throw new ParserError(this, this.currentPosition, 'Unexpected end of string');
    }

    getLineAndColumnFromPosition = (position: number): { line: number, column: number } => {
        let line = 1;
        let column = 1;

        for (let i = 0; i < position; i++) {
            if (this.input[i] === '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
        }

        return { line, column };
    }

    private next = (): IToken => {
        let token: IToken = this.nextWithComments();

        while (token && (token.type === 'singleComment' || token.type === 'multiComment')) {
            token = this.nextWithComments();
        }

        return token;
    }

    private nextWithComments = (): IToken => {
        let type: ITokenType | null = null;
        let curToken = '';
        let inString = false;
        let start: number = -1;

        this.lastPosition = this.currentPosition;

        const createToken = (overrideType?: ITokenType, overrideValue?: any): IToken => ({
            type: overrideType || type,
            value: overrideValue === undefined ? curToken : overrideValue,
            position: start
        });

        const createSymbol = (cur: string, symbolList: string[], overrideType?: ITokenType): IToken => {
            let valid = [...symbolList];
            start = this.currentPosition;

            while (valid.length >= 1 && this.currentPosition < this.input.length && !isWhite(cur)) {
                const filtered = valid.filter(symbol => symbol.startsWith(curToken + cur));
                if (filtered.length > 0) {
                    curToken += cur;
                    valid = filtered;
                    cur = this.input[++this.currentPosition];
                } else {
                    break;
                }
            }

            const found = valid.find(symbol => symbol === curToken);

            if (found) {
                return createToken(overrideType || curToken as ITokenType, curToken);
            } else {
                throw new ParserError(this, start, `Unrecognised token '${curToken}'`);
            }
        };

        const createSingleLineComment = (): IToken => {
            let comment = '';
            const position = this.currentPosition;
            for (
                ;
                this.currentPosition < this.input.length && this.input[this.currentPosition] !== '\n';
                this.currentPosition++) {
                comment += this.input[this.currentPosition];
            }

            return {
                type: 'singleComment',
                position,
                value: comment
            };
        };

        const createMultiLineComment = (): IToken => {
            const comment = '';
            const position = this.currentPosition;

            for (; this.currentPosition < this.input.length; this.currentPosition++) {
                const cur = this.input[this.currentPosition];
                const next = (this.currentPosition < this.input.length - 1) && this.input[this.currentPosition + 1];

                if (cur === '*' && next === '/') {
                    this.currentPosition += 2;
                    return {
                        type: 'multiComment',
                        position,
                        value: comment
                    };
                }
            }

            throw new ParserError(this, this.currentPosition, 'Unclosed comment');
        };

        for (; this.currentPosition < this.input.length; this.currentPosition++) {
            const cur = this.input[this.currentPosition];
            const next = (this.currentPosition < this.input.length - 1) && this.input[this.currentPosition + 1];

            switch (type) {
                case null: {
                    if (cur === '/' && next === '/') {
                        return createSingleLineComment();
                    } else if (cur === '/' && next === '*') {
                        return createMultiLineComment();
                    } else if (isAlpha(cur)) {
                        type = 'identifier';
                    } else if (isDigit(cur)) {
                        type = 'integer';
                    } else if (cur === '=') { // Special case for '=>'
                        if (this.input.length >= this.currentPosition + 1 && this.input[this.currentPosition + 1] === '>') {
                            start = this.currentPosition;
                            this.currentPosition += 2;
                            return createToken('=>', curToken);
                        }

                        return createSymbol(cur, operators as unknown as string[], 'operator');
                    } else if (symbols.find(symbol => symbol[0] === cur)) {
                        return createSymbol(cur, symbols as unknown as string[]);
                    } else if (operators.find(op => op[0] === cur)) {
                        return createSymbol(cur, operators as unknown as string[], 'operator');
                    } else if (cur === '\'') {
                        type = 'stringSingleQuote';
                    } else if (cur === '"') {
                        type = 'stringDoubleQuote';
                    } else if (!isWhite(cur)) {
                        throw new ParserError(this, this.currentPosition, `Invalid character '${cur}'`);
                    }

                    if (type) {
                        start = this.currentPosition;
                    }

                    break;
                }

                case 'identifier': {
                    if (!isAlpha(cur) && !isDigit(cur)) {
                        if (curToken in keywordValues) {
                            return createToken(curToken as ITokenType, keywordValues[curToken]);
                        } else if ((keywords as unknown as string[]).includes(curToken)) {
                            return createToken(curToken as ITokenType);
                        }

                        return createToken();
                    }

                    break;
                }

                case 'integer': {
                    if (cur === '.') {
                        type = 'float';
                    } else if (!isDigit(cur)) {
                        return createToken('number', parseInt(curToken, 10));
                    }

                    break;
                }

                case 'float': {
                    if (!isDigit(cur)) {
                        return createToken('number', parseFloat(curToken));
                    }

                    break;
                }

                case 'stringSingleQuote': {
                    inString = true;

                    if (cur === '\'') {
                        inString = false;
                        this.currentPosition++;
                        return createToken('string', curToken.substring(1, curToken.length));
                    }
                }

                case 'stringDoubleQuote': {
                    inString = true;

                    if (cur === '"') {
                        inString = false;
                        this.currentPosition++;
                        return createToken('string', curToken.substring(1, curToken.length));
                    }
                }
            }

            if (inString || !isWhite(cur)) {
                curToken += cur;
            }
        }
    }
}
