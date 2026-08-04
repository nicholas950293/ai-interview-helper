// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.venv/**',
      '**/__pycache__/**',
      '**/dist/**',
      '**/build/**',
      // Next 的建置產物與自動產生的型別宣告
      '**/.next/**',
      '**/out/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/perf-results/**',
      '**/*.min.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['backend/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // 憲章「憑證隔離」：前端程式碼 MUST NOT 觸及模型金鑰。
    files: ['frontend/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: '前端不得讀取 process.env；模型憑證僅存在於 BFF。' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // 憲章原則 V 的三組憑證：雙供應商金鑰與 Supabase service role key
          selector:
            'Identifier[name=/^(GEMINI_API_KEY|GOOGLE_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY)$/]',
          message: '模型與資料庫憑證 MUST NOT 出現於前端程式碼（憲章「憑證隔離」）。',
        },
      ],
    },
  },
  {
    // Route Handler 是**伺服端**程式碼，編譯進 .next/server/ 而非送到瀏覽器，
    // 因此讀 process.env 不違反憑證隔離——BFF 代理需要知道後端位址。
    // 刻意只放行 `process`：金鑰識別字的禁令（no-restricted-syntax）仍然生效，
    // 這裡若出現 GOOGLE_API_KEY 之類的名稱一樣會被擋下。
    // CI 的憑證隔離檢查掃的是 .next/static/（真正送到瀏覽器的那一份），
    // 本目錄的程式碼不在其中。
    files: ['frontend/src/app/api/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    // 建置／測試設定檔執行於 Node，不會進入前端 bundle。
    files: ['frontend/*.config.ts', 'frontend/tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    files: ['**/tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-globals': 'off',
    },
  }
);
