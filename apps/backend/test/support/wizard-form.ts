import type {
  NewPropertyFormV2,
  PropertyImage,
} from '../../../frontend/features/employee-properties/components/new-property-model-v2';
import { initialNewPropertyFormV2 } from '../../../frontend/features/employee-properties/components/new-property-model-v2';
import type { PropertyFormInput } from '../../../frontend/lib/property-adapter';

/** The wizard form shape minus the two frontend-only fields. */
type WizardFormInput = Omit<NewPropertyFormV2, 'pastedText' | 'image'>;

/**
 * The wizard's live form is `PropertyFormInput` plus its own
 * `pastedText`/`image` fields. Both fragments always travel together on a real
 * save, so the regression tests keep them together too.
 */
export function wizardForm(
  form: PropertyFormInput,
  overrides: Partial<Pick<NewPropertyFormV2, 'pastedText' | 'image'>> = {},
): NewPropertyFormV2 {
  const base = form as unknown as WizardFormInput;
  const out: NewPropertyFormV2 = {
    ...initialNewPropertyFormV2,
    ...base,
    pastedText: overrides.pastedText ?? '',
    image: overrides.image ?? null,
  };
  return out;
}

/** Round-trip guard: the wizard form still carries the adapter's fields. */
export function asFormInput(form: NewPropertyFormV2): PropertyFormInput {
  return form as unknown as PropertyFormInput;
}

export type { PropertyImage };
