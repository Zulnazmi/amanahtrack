type T = (ms: string, en: string) => string;

export function roleName(role: string | undefined, t: T): string {
  switch (role) {
    case 'admin':
      return t('Pentadbir', 'Admin');
    case 'treasurer':
      return t('Bendahari', 'Treasurer');
    case 'auditor':
      return t('Juruaudit', 'Auditor');
    case 'committee':
      return t('Ahli Jawatankuasa', 'Committee');
    default:
      return role ?? '';
  }
}
