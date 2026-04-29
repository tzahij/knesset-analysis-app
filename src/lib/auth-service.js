const crypto = require("crypto");

const ROLE_ORDER = {
  guest: 0,
  basic: 1,
  advanced: 2,
  admin: 3,
};

const ROLE_ENV_DEFINITIONS = [
  {
    role: "basic",
    defaultDisplayName: "Basic User",
    usernameEnv: "AUTH_BASIC_USERNAME",
    passwordEnv: "AUTH_BASIC_PASSWORD",
    displayNameEnv: "AUTH_BASIC_DISPLAY_NAME",
  },
  {
    role: "advanced",
    defaultDisplayName: "Advanced User",
    usernameEnv: "AUTH_ADVANCED_USERNAME",
    passwordEnv: "AUTH_ADVANCED_PASSWORD",
    displayNameEnv: "AUTH_ADVANCED_DISPLAY_NAME",
  },
  {
    role: "admin",
    defaultDisplayName: "Admin",
    usernameEnv: "AUTH_ADMIN_USERNAME",
    passwordEnv: "AUTH_ADMIN_PASSWORD",
    displayNameEnv: "AUTH_ADMIN_DISPLAY_NAME",
  },
];

function toBase64Url(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function parseCookies(headerValue) {
  const cookies = {};

  for (const entry of String(headerValue || "").split(";")) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(Number(options.maxAge) || 0))}`);
  }

  parts.push(`Path=${options.path || "/"}`);

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  parts.push(`SameSite=${options.sameSite || "Lax"}`);

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.priority) {
    parts.push(`Priority=${options.priority}`);
  }

  return parts.join("; ");
}

function compareSecretValues(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function dedupeRoles(users) {
  return [...new Set(users.map((user) => user.role))].sort(
    (left, right) => (ROLE_ORDER[left] || 0) - (ROLE_ORDER[right] || 0),
  );
}

class AuthService {
  constructor(options = {}) {
    this.cookieName = process.env.AUTH_COOKIE_NAME || "knesset_auth_session";
    this.sessionTtlMs =
      (Number(process.env.AUTH_SESSION_TTL_DAYS || 14) || 14) * 24 * 60 * 60 * 1000;
    this.cookieSecureMode = String(process.env.AUTH_COOKIE_SECURE || "auto")
      .trim()
      .toLowerCase();
    this.isProductionLike =
      String(process.env.NODE_ENV || "").trim().toLowerCase() === "production" ||
      String(process.env.APP_ENV || "").trim().toLowerCase() === "staging";
    this.initialized = false;
    this.secret = "";
    this.users = [];
    this.availableRoles = [];
    this.authConfigured = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.users = this.loadConfiguredUsers();
    this.availableRoles = dedupeRoles(this.users);
    this.authConfigured = this.users.length > 0;
    this.secret = this.loadSessionSecret();
    this.initialized = true;
  }

  loadConfiguredUsers() {
    const users = [];
    const seenUsernames = new Set();
    const rawJsonUsers = String(process.env.AUTH_USERS_JSON || "").trim();

    const addUser = (definition, sourceLabel) => {
      const role = normalizeRole(definition.role);
      const username = String(definition.username || "").trim();
      const password = String(definition.password || "");
      const displayName = String(definition.displayName || "").trim() || username;

      if (!(role in ROLE_ORDER) || role === "guest") {
        throw new Error(`Invalid auth role "${definition.role}" in ${sourceLabel}.`);
      }

      if (!username) {
        throw new Error(`Missing username for auth user in ${sourceLabel}.`);
      }

      if (!password) {
        throw new Error(`Missing password for auth user "${username}" in ${sourceLabel}.`);
      }

      if (this.isProductionLike && password.length < 12) {
        throw new Error(
          `Password for auth user "${username}" is too short for production/staging. Use at least 12 characters.`,
        );
      }

      const normalizedUsername = username.toLowerCase();

      if (seenUsernames.has(normalizedUsername)) {
        throw new Error(`Duplicate auth username "${username}" in ${sourceLabel}.`);
      }

      seenUsernames.add(normalizedUsername);
      users.push({
        username,
        normalizedUsername,
        displayName,
        role,
        password,
      });
    };

    if (rawJsonUsers) {
      let parsedUsers = null;

      try {
        parsedUsers = JSON.parse(rawJsonUsers);
      } catch (error) {
        throw new Error(`AUTH_USERS_JSON is not valid JSON: ${error.message}`);
      }

      if (!Array.isArray(parsedUsers)) {
        throw new Error("AUTH_USERS_JSON must be a JSON array.");
      }

      parsedUsers.forEach((user, index) => {
        addUser(user || {}, `AUTH_USERS_JSON[${index}]`);
      });
    }

    for (const definition of ROLE_ENV_DEFINITIONS) {
      const username = String(process.env[definition.usernameEnv] || "").trim();
      const password = String(process.env[definition.passwordEnv] || "");

      if ((username && !password) || (!username && password)) {
        throw new Error(
          `Set both ${definition.usernameEnv} and ${definition.passwordEnv}, or leave both empty.`,
        );
      }

      if (!username || !password) {
        continue;
      }

      addUser(
        {
          role: definition.role,
          username,
          password,
          displayName:
            String(process.env[definition.displayNameEnv] || "").trim() ||
            definition.defaultDisplayName,
        },
        definition.usernameEnv,
      );
    }

    return users.sort((left, right) => (ROLE_ORDER[left.role] || 0) - (ROLE_ORDER[right.role] || 0));
  }

  loadSessionSecret() {
    const configuredSecret = String(process.env.AUTH_SESSION_SECRET || "").trim();

    if (configuredSecret) {
      if (this.isProductionLike && configuredSecret.length < 32) {
        throw new Error("AUTH_SESSION_SECRET must be at least 32 characters in production/staging.");
      }

      return configuredSecret;
    }

    if (this.isProductionLike && this.authConfigured) {
      throw new Error(
        "Missing AUTH_SESSION_SECRET. Set a strong session secret in the production or staging environment.",
      );
    }

    return crypto.randomBytes(32).toString("hex");
  }

  signValue(value) {
    return crypto.createHmac("sha256", this.secret).update(String(value)).digest("base64url");
  }

  findUser(username) {
    const normalizedUsername = String(username || "").trim().toLowerCase();
    return this.users.find((candidate) => candidate.normalizedUsername === normalizedUsername) || null;
  }

  verifyPassword(password, user) {
    return compareSecretValues(password, user?.password);
  }

  buildSessionPayload(user) {
    return {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      expiresAt: Date.now() + this.sessionTtlMs,
    };
  }

  createSessionToken(user) {
    const encodedPayload = toBase64Url(JSON.stringify(this.buildSessionPayload(user)));
    const signature = this.signValue(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  parseSessionToken(token) {
    const [encodedPayload, signature] = String(token || "").split(".");

    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = this.signValue(encodedPayload);

    if (!compareSecretValues(signature, expectedSignature)) {
      return null;
    }

    try {
      const payload = JSON.parse(fromBase64Url(encodedPayload));

      if (!payload || Number(payload.expiresAt) <= Date.now()) {
        return null;
      }

      const role = normalizeRole(payload.role);

      if (!(role in ROLE_ORDER) || role === "guest") {
        return null;
      }

      const user = this.findUser(payload.username);

      if (!user || user.role !== role) {
        return null;
      }

      return {
        username: user.username,
        displayName: user.displayName,
        role,
        expiresAt: Number(payload.expiresAt),
      };
    } catch {
      return null;
    }
  }

  hasRole(currentRole, minimumRole) {
    return (ROLE_ORDER[currentRole] || 0) >= (ROLE_ORDER[minimumRole] || 0);
  }

  getRoleLabel(role) {
    switch (role) {
      case "basic":
        return "Basic";
      case "advanced":
        return "Advanced";
      case "admin":
        return "Admin";
      default:
        return "Guest";
    }
  }

  buildPublicSession(session) {
    if (!session) {
      return {
        authenticated: false,
        role: "guest",
        roleLabel: this.getRoleLabel("guest"),
        user: null,
        authConfigured: this.authConfigured,
        availableRoles: [...this.availableRoles],
      };
    }

    return {
      authenticated: true,
      role: session.role,
      roleLabel: this.getRoleLabel(session.role),
      user: {
        username: session.username,
        displayName: session.displayName,
        role: session.role,
      },
      authConfigured: this.authConfigured,
      availableRoles: [...this.availableRoles],
    };
  }

  getAuthErrorMessage(minimumRole) {
    if (!this.authConfigured) {
      return "This action is unavailable because no login accounts are configured on this server.";
    }

    switch (minimumRole) {
      case "advanced":
        return "This action requires an advanced or admin account.";
      case "admin":
        return "This action requires an admin account.";
      default:
        return "This action requires a logged-in account.";
    }
  }

  async attachRequestAuth(request) {
    await this.initialize();
    const cookies = parseCookies(request.headers.cookie);
    const session = this.parseSessionToken(cookies[this.cookieName]);

    request.auth = {
      ...this.buildPublicSession(session),
      session,
    };
  }

  async authenticate(username, password) {
    await this.initialize();

    if (!this.authConfigured) {
      return null;
    }

    const user = this.findUser(username);

    if (!user || !this.verifyPassword(password, user)) {
      return null;
    }

    return user;
  }

  shouldUseSecureCookies(request) {
    if (this.cookieSecureMode === "always" || this.cookieSecureMode === "true") {
      return true;
    }

    if (this.cookieSecureMode === "never" || this.cookieSecureMode === "false") {
      return false;
    }

    const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();

    return Boolean(request?.secure || forwardedProto === "https");
  }

  setSessionCookie(response, user, request) {
    const token = this.createSessionToken(user);
    response.setHeader(
      "Set-Cookie",
      serializeCookie(this.cookieName, token, {
        maxAge: Math.floor(this.sessionTtlMs / 1000),
        path: "/",
        sameSite: "Lax",
        httpOnly: true,
        secure: this.shouldUseSecureCookies(request),
        priority: "High",
      }),
    );
  }

  clearSessionCookie(response, request) {
    response.setHeader(
      "Set-Cookie",
      serializeCookie(this.cookieName, "", {
        maxAge: 0,
        path: "/",
        sameSite: "Lax",
        httpOnly: true,
        secure: this.shouldUseSecureCookies(request),
        priority: "High",
      }),
    );
  }
}

module.exports = {
  AuthService,
  ROLE_ORDER,
};
