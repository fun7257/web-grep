declare module "picomatch" {
  type PicomatchOptions = {
    readonly dot?: boolean;
    readonly nocase?: boolean;
  };
  function picomatch(
    glob: string,
    options?: PicomatchOptions,
  ): (input: string) => boolean;
  export default picomatch;
}
