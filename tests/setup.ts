import "dotenv/config";

// Testler test veritabanını kullanır; geliştirme DB'sine dokunulmaz.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
(process.env as Record<string, string>).NODE_ENV = "test";
