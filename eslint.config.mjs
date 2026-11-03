import globals from 'globals';
export default [{
    files: ['*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser, module: 'readonly' } },
    rules: { 'no-unused-vars': ['error', {argsIgnorePattern: '^_'}], 'no-undef': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'error', 'no-dupe-keys': 'error' }
}];
