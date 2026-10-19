import { describe, it } from "node:test";
import assert from "node:assert";
import { parseEnv, parseEnvNumber, parseEnvBoolean } from "./parseEnv.js";

describe("parseEnv utility", () => {
  it("treats unset environment variables as defaultValue or undefined", () => {
    delete process.env.TEST_UNSET_VAR;
    assert.strictEqual(parseEnv("TEST_UNSET_VAR"), undefined);
    assert.strictEqual(parseEnv("TEST_UNSET_VAR", "default_val"), "default_val");
  });

  it("treats empty string environment variables as unset", () => {
    process.env.TEST_EMPTY_VAR = "";
    assert.strictEqual(parseEnv("TEST_EMPTY_VAR"), undefined);
    assert.strictEqual(parseEnv("TEST_EMPTY_VAR", "fallback"), "fallback");
  });

  it("treats whitespace-only environment variables as unset", () => {
    process.env.TEST_WHITESPACE_VAR = "   ";
    assert.strictEqual(parseEnv("TEST_WHITESPACE_VAR"), undefined);
    assert.strictEqual(parseEnv("TEST_WHITESPACE_VAR", "fallback"), "fallback");
  });

  it("returns trimmed value when non-empty", () => {
    process.env.TEST_VALID_VAR = "  hello world  ";
    assert.strictEqual(parseEnv("TEST_VALID_VAR"), "hello world");
  });

  it("handles BIRTHDAY_SEND_HOUR empty properly as default 7 instead of 0", () => {
    process.env.BIRTHDAY_SEND_HOUR = "";
    const hour = parseEnvNumber("BIRTHDAY_SEND_HOUR", 7);
    assert.strictEqual(hour, 7, "Empty BIRTHDAY_SEND_HOUR must fall back to default hour 7, not 0");

    process.env.BIRTHDAY_SEND_HOUR = "9";
    const hourSet = parseEnvNumber("BIRTHDAY_SEND_HOUR", 7);
    assert.strictEqual(hourSet, 9);
  });

  it("parses numbers and booleans correctly with fallbacks", () => {
    process.env.TEST_NUM = "42";
    assert.strictEqual(parseEnvNumber("TEST_NUM", 10), 42);

    process.env.TEST_NUM_INVALID = "abc";
    assert.strictEqual(parseEnvNumber("TEST_NUM_INVALID", 10), 10);

    process.env.TEST_BOOL_TRUE = "true";
    assert.strictEqual(parseEnvBoolean("TEST_BOOL_TRUE", false), true);

    process.env.TEST_BOOL_YES = "yes";
    assert.strictEqual(parseEnvBoolean("TEST_BOOL_YES", false), true);

    process.env.TEST_BOOL_FALSE = "0";
    assert.strictEqual(parseEnvBoolean("TEST_BOOL_FALSE", true), false);

    process.env.TEST_BOOL_EMPTY = "";
    assert.strictEqual(parseEnvBoolean("TEST_BOOL_EMPTY", true), true);
  });
});
