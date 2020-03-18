import { FunctionNode } from './nodes';
import { IScope, Runtime } from './runtime';

export class FuncClosure {
    name: string = '<anonymous>';

    runtime: Runtime;
    thisArg: any;
    scope: IScope = {};
    funcExpr: FunctionNode;
    func: (...funcArgs) => any;

    evaluate = (runtime: Runtime, args: any[], thisArg?: any): any => {
        this.thisArg = thisArg;
        const oldThis = runtime.getThisArg();
        runtime.setThisArg(thisArg);
        const result = this.func.apply(thisArg || global, args);
        runtime.setThisArg(oldThis);
        return result;
    }

    apply = (thisArg: any, args: {[name: string]: any}) => {
        this.thisArg = thisArg;
        return this.func.apply(thisArg, args);
    }

    toString() {
        return `${this.name}( ... ) { ... }`;
    }
}

/**
 * Because we are interpreting the parse nodes directly there's no pretty way to
 * return a value from the function. The stack has to be unrolled one way or another.
 *
 * A simple hack for this is to throw a special exception and catch it at the function scope
 */
export class ReturnValueException {
    constructor(public value: any) {
    }
}
