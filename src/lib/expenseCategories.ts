import type { IconName } from '../ui/Icon';

export type ExpenseCategory =
  | 'software' | 'hosting_domains' | 'equipment' | 'internet_data' | 'phone' | 'travel'
  | 'contractors' | 'advertising' | 'printing' | 'stock_assets' | 'training' | 'office' | 'bank_fees' | 'other';

/** In the order shown on the Log expense grid: most common first. Matches the database enum. */
export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; icon: IconName }[] = [
  { value: 'software', label: 'Software & subscriptions', icon: 'laptop' },
  { value: 'hosting_domains', label: 'Hosting & domains', icon: 'globe' },
  { value: 'internet_data', label: 'Internet & data', icon: 'wifi' },
  { value: 'phone', label: 'Phone', icon: 'phone' },
  { value: 'equipment', label: 'Equipment', icon: 'monitor' },
  { value: 'contractors', label: 'Freelancers & contractors', icon: 'person' },
  { value: 'advertising', label: 'Advertising', icon: 'megaphone' },
  { value: 'travel', label: 'Travel & fuel', icon: 'fuel' },
  { value: 'printing', label: 'Printing', icon: 'printer' },
  { value: 'stock_assets', label: 'Stock photos & fonts', icon: 'image' },
  { value: 'training', label: 'Courses & training', icon: 'book' },
  { value: 'office', label: 'Office & admin', icon: 'briefcase' },
  { value: 'bank_fees', label: 'Bank fees', icon: 'bank' },
  { value: 'other', label: 'Other', icon: 'dots' },
];

const BY_VALUE = new Map(EXPENSE_CATEGORIES.map((c) => [c.value, c]));

export function categoryLabel(c: ExpenseCategory): string {
  return BY_VALUE.get(c)?.label ?? c;
}

export function categoryIcon(c: ExpenseCategory): IconName {
  return BY_VALUE.get(c)?.icon ?? 'dots';
}
