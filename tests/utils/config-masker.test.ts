import { describe, it, expect } from "vitest";
import { maskSensitiveConfig } from "../../src/utils/config-masker.js";

describe("maskSensitiveConfig", () => {
  it("should mask GITHUB_WEBHOOK_SECRET", () => {
    const config = {
      GITHUB_WEBHOOK_SECRET: "super_secret_webhook_token",
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.GITHUB_WEBHOOK_SECRET).toBe("********");
    expect(masked.normalField).toBe("normal_value");
  });

  it("should mask fields containing 'secret' (case insensitive)", () => {
    const config = {
      clientSecret: "secret123",
      SECRET_KEY: "another_secret",
      UserSecret: "user_secret",
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.clientSecret).toBe("********");
    expect(masked.SECRET_KEY).toBe("********");
    expect(masked.UserSecret).toBe("********");
    expect(masked.normalField).toBe("normal_value");
  });

  it("should mask fields containing 'password' (case insensitive)", () => {
    const config = {
      password: "my_password",
      userPassword: "user_pass",
      PASSWORD_FIELD: "secret_password",
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.password).toBe("********");
    expect(masked.userPassword).toBe("********");
    expect(masked.PASSWORD_FIELD).toBe("********");
    expect(masked.normalField).toBe("normal_value");
  });

  it("should mask fields containing 'token' (case insensitive)", () => {
    const config = {
      accessToken: "access_token_123",
      authToken: "auth_token_456",
      TOKEN: "main_token",
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.accessToken).toBe("********");
    expect(masked.authToken).toBe("********");
    expect(masked.TOKEN).toBe("********");
    expect(masked.normalField).toBe("normal_value");
  });

  it("should mask fields ending with 'key' (case insensitive)", () => {
    const config = {
      apiKey: "api_key_123",
      privateKey: "private_key_456",
      SECRET_KEY: "secret_key_789",
      normalField: "normal_value",
      keyString: "this_should_not_be_masked", // doesn't end with 'key'
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.apiKey).toBe("********");
    expect(masked.privateKey).toBe("********");
    expect(masked.SECRET_KEY).toBe("********");
    expect(masked.normalField).toBe("normal_value");
    expect(masked.keyString).toBe("this_should_not_be_masked");
  });

  it("should mask 'apikey' specifically", () => {
    const config = {
      apikey: "my_api_key",
      APIKEY: "another_api_key",
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.apikey).toBe("********");
    expect(masked.APIKEY).toBe("********");
    expect(masked.normalField).toBe("normal_value");
  });

  it("should handle nested objects recursively", () => {
    const config = {
      database: {
        password: "db_password",
        host: "localhost",
        credentials: {
          apiKey: "nested_api_key",
          username: "admin",
        },
      },
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.database.password).toBe("********");
    expect(masked.database.host).toBe("localhost");
    expect(masked.database.credentials.apiKey).toBe("********");
    expect(masked.database.credentials.username).toBe("admin");
    expect(masked.normalField).toBe("normal_value");
  });

  it("should handle arrays recursively", () => {
    const config = {
      servers: [
        {
          password: "server1_password",
          host: "server1.com",
        },
        {
          apiKey: "server2_api_key",
          port: 3000,
        },
      ],
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.servers[0].password).toBe("********");
    expect(masked.servers[0].host).toBe("server1.com");
    expect(masked.servers[1].apiKey).toBe("********");
    expect(masked.servers[1].port).toBe(3000);
    expect(masked.normalField).toBe("normal_value");
  });

  it("should handle complex nested structures", () => {
    const config = {
      services: {
        auth: {
          providers: [
            {
              name: "github",
              clientSecret: "github_client_secret",
              clientId: "github_client_id",
            },
            {
              name: "google",
              apiKey: "google_api_key",
              scopes: ["email", "profile"],
            },
          ],
        },
        database: {
          connections: {
            primary: {
              password: "primary_db_password",
              host: "primary.db.com",
            },
            secondary: {
              password: "secondary_db_password",
              host: "secondary.db.com",
            },
          },
        },
      },
      version: "1.0.0",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.services.auth.providers[0].clientSecret).toBe("********");
    expect(masked.services.auth.providers[0].clientId).toBe("github_client_id");
    expect(masked.services.auth.providers[1].apiKey).toBe("********");
    expect(masked.services.auth.providers[1].scopes).toEqual(["email", "profile"]);
    expect(masked.services.database.connections.primary.password).toBe("********");
    expect(masked.services.database.connections.primary.host).toBe("primary.db.com");
    expect(masked.services.database.connections.secondary.password).toBe("********");
    expect(masked.services.database.connections.secondary.host).toBe("secondary.db.com");
    expect(masked.version).toBe("1.0.0");
  });

  it("should handle null and undefined values", () => {
    const config = {
      password: null,
      apiKey: undefined,
      normalField: "normal_value",
      nested: {
        secret: null,
        value: undefined,
      },
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.password).toBeNull();
    expect(masked.apiKey).toBeUndefined();
    expect(masked.normalField).toBe("normal_value");
    expect(masked.nested.secret).toBeNull();
    expect(masked.nested.value).toBeUndefined();
  });

  it("should handle primitive values", () => {
    expect(maskSensitiveConfig("string")).toBe("string");
    expect(maskSensitiveConfig(123)).toBe(123);
    expect(maskSensitiveConfig(true)).toBe(true);
    expect(maskSensitiveConfig(null)).toBeNull();
    expect(maskSensitiveConfig(undefined)).toBeUndefined();
  });

  it("should not modify the original object", () => {
    const original = {
      password: "secret_password",
      normalField: "normal_value",
    };

    const originalCopy = { ...original };
    const masked = maskSensitiveConfig(original);

    expect(original).toEqual(originalCopy);
    expect(original.password).toBe("secret_password");
    expect(masked.password).toBe("********");
  });

  it("should handle empty objects and arrays", () => {
    const config = {
      emptyObject: {},
      emptyArray: [],
      normalField: "normal_value",
    };

    const masked = maskSensitiveConfig(config);

    expect(masked.emptyObject).toEqual({});
    expect(masked.emptyArray).toEqual([]);
    expect(masked.normalField).toBe("normal_value");
  });
});