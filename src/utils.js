export function invariant(condition, message = 'Illegal state') {
    if (!condition) {
        throw new Error(`[mobx-spine] ${message}`);
    }
}

// lodash's `snakeCase` method removes dots from the string; this breaks mobx-spine
export function camelToSnake(s) {
    return s.replace(/([A-Z])/g, $1 => '_' + $1.toLowerCase());
}

// lodash's `camelCase` method removes dots from the string; this breaks mobx-spine
export function snakeToCamel(s) {
    if (s.startsWith('_')) {
        return s;
    }
    return s.replace(/_\w/g, m => m[1].toUpperCase());
}
