"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function LoginView() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const wantsManagement = nextPath.startsWith("/management");
  const wantsUser =
    searchParams.get("mode") === "user" || nextPath.startsWith("/account");
  const error = searchParams.get("error");
  const [email, setEmail] = useState("");

  return (
    <div className="login-shell">
      <div className="atmosphere" aria-hidden />
      <section className="login-panel">
        <p className="brand login-brand">MintPicks</p>
        {error && <p className="login-error">{error}</p>}

        <form method="POST" action="/api/auth/session" className="login-actions">
          <input type="hidden" name="next" value={wantsManagement || wantsUser ? "/" : nextPath} />
          <button type="submit" className="login-submit secondary">
            Guest sign in
          </button>
        </form>

        <form method="POST" action="/api/auth/user-session" className="login-actions">
          <label className="login-label" htmlFor="user-email">
            Email
          </label>
          <input
            id="user-email"
            name="email"
            type="email"
            required
            className="login-input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <button
            type="submit"
            className={wantsUser ? "login-submit" : "login-submit secondary"}
            style={{ marginTop: "0.65rem" }}
          >
            User login
          </button>
        </form>

        <form method="POST" action="/api/auth/management-session" className="login-actions">
          <button
            type="submit"
            className={wantsManagement ? "login-submit" : "login-submit secondary"}
          >
            Management login
          </button>
        </form>
      </section>
    </div>
  );
}
