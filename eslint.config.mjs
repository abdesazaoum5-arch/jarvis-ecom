import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'apps/command-center/public/js/**', 'jarvis/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        // Node
        process: 'readonly', Buffer: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        fetch: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly', URL: 'readonly',
        structuredClone: 'readonly', NodeJS: 'readonly', SpeechSynthesisUtterance: 'readonly',
        // Browser
        window: 'readonly', document: 'readonly', navigator: 'readonly', performance: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', EventSource: 'readonly',
        HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly', CanvasRenderingContext2D: 'readonly', KeyboardEvent: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Truthfulness guard: flag any code that silently swallows a missing value
      // into a default. Reviewed case by case; there should be none.
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name='parseFloat'] > Literal",
        message: 'Parse from a retrieved value, not from a literal.',
      }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
);
