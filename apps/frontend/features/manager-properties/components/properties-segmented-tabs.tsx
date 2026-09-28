import type { ComponentProps } from 'react';
import { PropertiesTabs } from './properties-tabs';
import styles from './properties-segmented-tabs.module.css';

// Shares keyboard navigation and ARIA behavior with the employee follow-up tabs.
export function PropertiesSegmentedTabs(
  props: Omit<ComponentProps<typeof PropertiesTabs>, 'className'>,
) {
  return <PropertiesTabs {...props} className={styles.segmented} />;
}
