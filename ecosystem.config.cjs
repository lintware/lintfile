module.exports = {
  apps: [
    {
      name: "lintfile",
      script: "server.ts",
      interpreter: "bun",
      env: {
        PORT: "8473",
        PUBLIC_HOST: "file.lintware.com",
      },
      watch: false,
      autorestart: true,
    },
  ],
};
