import type { ComponentProps } from 'react';
import { PropertiesTabs } from './properties-tabs';
import styles from './properties-segmented-tabs.module.css';

// Shares keyboard navigation and ARIA behavior with the employee follow-up tabs.
export function PropertiesSegmentedTabs(
  props: Omit<ComponentProps<typeof PropertiesTabs>, 'className' | 'wrapperClassName'>,
) {
  // The pill becomes a WRAPPER`; the tablist inside it is the scroller. The
  // painted scroll indicator anchors to this wrapper, so it can never leave
  // the bar (drawer variant only — plain tabs usage is untouched).
  return <PropertiesTabs {...props} wrapperClassName={styles.segmented} />;
}
