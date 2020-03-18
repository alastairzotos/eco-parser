import { Dictionary } from 'lodash';

import { FuncClosure } from './closure';
import { ParseNode } from './nodes';

export type IScope = Dictionary<any>;

export interface IRuntimeArgs {
    scope: IScope;
    global: any;
}

export class Runtime {
    global: any;

    private scope: IScope[] = [];
    private thisArg: any;
    private stack: FuncClosure[] = [];

    setArgs = (args: IRuntimeArgs) => {
        this.global = args.global;
        this.scope.push(args.scope);
    }

    pushStack = (closure: FuncClosure) => this.stack.push(closure);
    popStack = (): FuncClosure => this.stack.pop();
    stackTop = (): FuncClosure => {
        if (this.stack.length === 0) { return null; }
        return this.stack[this.stack.length - 1];
    }

    getThisArg = () => this.thisArg;
    setThisArg = (value: any) => {
        this.thisArg = value;
    }

    pushScope = (scope?: IScope) => {
        this.scope.push(scope || {});
    }
    popScope = (): IScope => this.scope.pop();
    getScope = (): IScope => this.scope[this.scope.length - 1];
    getFullScope = (): IScope => {
        const scope: IScope = {};

        this.scope.forEach(scp => {
            Object.keys(scp).forEach(sk => {
                scope[sk] = scp[sk];
            });
        });

        return scope;
    }

    getLocal = (name: string) => {
        for (let i = this.scope.length - 1; i > -1; i--) {
            if (this.scope[i][name] !== undefined) {
                return this.scope[i][name];
            }
        }

        if (this.global[name]) {
            return this.global[name];
        }

        return undefined;
    }

    setLocal = (name: string, value: any) => {
        for (let i = this.scope.length - 1; i > -1; i--) {
            if (name in this.scope[i]) {
                this.scope[i][name] = value;
                return;
            }
        }
    }

    instantiate = (className: string, args: any[]) =>
        new this.global[className](...args)

    evaluateNode = (node: ParseNode) => {
        return node.evaluate(this);
    }
}
