declare module "register-protocol-win32" {
  function exists(name: string): Promise<boolean>;
  function install(name: string, command: string): Promise<void>;
  function uninstall(name: string): Promise<void>;
  export { exists, install, uninstall };
}
