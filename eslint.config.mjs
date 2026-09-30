import next from "eslint-config-next";

export default [
  { ignores: [".next/**", "src/generated/**", "node_modules/**", ".agents/**", ".windsurf/**", "playwright-report/**", "coverage/**"] },
  ...next,
];
