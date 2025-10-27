declare module 'neo4j-driver' {
  export type Integer = { toNumber(): number };
  export type Result = { records: Array<{ get: (key: string) => unknown }> };
  export type Session = {
    run: (cypher: string, params?: Record<string, unknown>) => Promise<Result>;
    close: () => Promise<void>;
  };
  export type Driver = {
    session: (config?: { defaultAccessMode?: unknown; database?: string }) => Session;
  };
  export const auth: { basic: (user: string, pass: string) => unknown };
  export const session: { READ: unknown };
  export function int(n: number): Integer;
  const neo4j: {
    driver: (uri: string, token: unknown) => Driver;
    auth: typeof auth;
    session: typeof session;
    int: typeof int;
  };
  export default neo4j;
}




