// ESLint 配置 — dsh-prompt-snippets
// 目标：给 2914 行的 client.js + 2000+ 行的 index.js 加最低限度护栏
// 规则选「推荐 + 合理」，不搞风格洁癖，只抓真 bug

export default [
  {
    // 通用：忽略 node_modules 和测试目录
    ignores: ["node_modules/**", "test/**"],
  },
  {
    // 主文件：index.js（host 半，Node.js）+ client.js（client 半，浏览器/DSH）
    files: ["index.js", "client.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js globals (index.js)
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __dirname: "readonly",
        // Browser/DSH globals (client.js)
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        console: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        queueMicrotask: "readonly",
        TextEncoder: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      // ── 推荐规则（ESLint 官方推荐） ──
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-undef": "error",
      "no-redeclare": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-extra-semi": "error",
      "no-func-assign": "error",
      "no-inner-declarations": "error",
      "no-invalid-regexp": "error",
      "no-irregular-whitespace": "error",
      "no-misleading-character-class": "error",
      "no-obj-calls": "error",
      "no-regex-spaces": "error",
      "no-sparse-arrays": "error",
      "no-unexpected-multiline": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "use-isnan": "error",
      "valid-typeof": "error",

      // ── 合理规则（抓常见 bug，不搞风格洁癖） ──
      "no-var": "error",           // 禁止 var，强制 let/const
      "prefer-const": "error",     // 优先 const
      "no-multi-spaces": "error",  // 禁止多余空格
      "no-trailing-spaces": "error", // 行尾不留空格
      "semi": ["error", "always"], // 强制分号
      "quotes": ["error", "double", { avoidEscape: true }], // 统一双引号
      "comma-dangle": ["error", "always-multiline"], // 多行对象/数组尾逗号
      "eqeqeq": ["error", "always", { null: "ignore" }], // 强制 ===（null 除外）
      "curly": ["error", "multi-line"], // 多行必须大括号
      "brace-style": ["error", "1tbs", { allowSingleLine: true }], // 大括号风格
      "indent": ["error", 2, { SwitchCase: 1 }], // 2 空格缩进
      "no-multiple-empty-lines": ["error", { max: 2, maxEOF: 1 }], // 最多 2 个连续空行
      "eol-last": ["error", "always"], // 文件末尾换行
      "no-console": "off", // console 在 CLI 插件里合法
      "no-process-exit": "off", // process.exit 在 CLI 里合法

      // ── 针对这个项目的特殊规则 ──
      "no-prototype-builtins": "off", // hasOwnProperty 用法常见
      "no-useless-escape": "off", // 正则里 \\{{ 是合法的
      "no-control-regex": "off", // 控制字符正则（如 \u0000-\u001f）合法
    },
  },
  {
    // 测试文件：允许更宽松的规则
    files: ["test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off", // 测试里常有未使用的变量
      "no-console": "off",     // 测试输出合法
    },
  },
];
