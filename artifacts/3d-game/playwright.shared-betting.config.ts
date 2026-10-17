import { defineConfig } from "@playwright/test";
import base from "./playwright.vegetable.config";
export default defineConfig({ ...base, testMatch: ["shared-betting.spec.ts", "vegetable-bowl.spec.ts"] });
