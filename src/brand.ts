// Everything that names the business, in one place.
export const BRAND = {
  appName: 'Blue Monday Admin',
  tradingName: 'Blue Monday Studios',
  wordmark: 'BLUE MONDAY',
  tagline: 'STUDIOS',
  /** Under the logo on the sign-in screen */
  signInSub: 'Studios · Quotes, invoices and records',
  /** Last line on invoice and quote PDFs */
  thanks: 'Thank you for your business.',
  /** File names: BlueMonday-records-2026-27.zip, BlueMonday-backup-2026-11-27.zip */
  filePrefix: 'BlueMonday',
  backupFormat: 'bluemonday-admin-backup',
  /** IndexedDB name for the offline expense queue (per site) */
  storageName: 'bluemonday-admin',
} as const;
