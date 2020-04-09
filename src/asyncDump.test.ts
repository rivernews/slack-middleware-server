// code referenced from https://gist.github.com/subfuzion/54a9413d02c6d9ba223076bebd49e38f

'use strict';

import { createHook } from 'async_hooks';
import Mocha from 'mocha';

const allResources = new Map();

// this will pull Mocha internals out of the stacks
const filterStack = Mocha.utils.stackTraceFilter();

const hook = createHook({
    init (asyncId, type, triggerAsyncId) {
        allResources.set(asyncId, {
            type,
            triggerAsyncId,
            stack: new Error().stack
        });
    },
    destroy (asyncId) {
        allResources.delete(asyncId);
    }
}).enable();

export const asyncDump = () => {
    hook.disable();
    console.error(`
STUFF STILL IN THE EVENT LOOP:`);
    allResources.forEach(value => {
        console.error(`Type: ${value.type}`);
        console.error(filterStack(value.stack));
        console.error('\n');
    });
};
