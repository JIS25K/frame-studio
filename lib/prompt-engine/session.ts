// Memory only: never written to URLs, persistent storage, or exported packages.
let accessCode = '';
export function setSessionCode(value: string) { accessCode = value; }
export function getSessionCode() { return accessCode; }
