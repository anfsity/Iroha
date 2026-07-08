export default (err: unknown): void => {
  if (typeof err === "object" && err !== null) {
    const errorObj = err as Record<string, any>;

    if (errorObj.stack) {
      console.error(errorObj.stack);
      delete errorObj.stack;
    }

    console.error(
      "ERROR".red,
      JSON.stringify(errorObj, Object.getOwnPropertyNames(errorObj), 4),
    );
  } else {
    console.error("ERROR".red, err);
  }
};
