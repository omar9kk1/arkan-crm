import type { ReactNode } from 'react';
import { LogoutButton } from '../../features/auth/components/logout-button';
import { Brand } from './brand';
export function WorkspaceShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace">
      <header className="workspace-header">
        <Brand />
        <span>{title}</span>
        <LogoutButton />
      </header>
      <main className="workspace-main">{children}</main>
    </div>
  );
}
