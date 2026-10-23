import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import type { SessionUser } from "@/lib/session";

const ROLE_LABEL = { expert: "Content expert", reviewer: "Reviewer", approver: "Approver", admin: "Admin" } as const;

export function AppShell({ user, current, children }: { user: SessionUser; current?: "units"; children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link href="/units" className="brand">
          Lesson Studio
        </Link>
        <nav className="nav" aria-label="Main">
          <Link href="/units" aria-current={current === "units" ? "page" : undefined}>
            Units
          </Link>
        </nav>
        <div className="who">
          <span>
            {user.name} · {ROLE_LABEL[user.role]}
          </span>
          <form action={logout}>
            <button className="btn btn-sm" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
