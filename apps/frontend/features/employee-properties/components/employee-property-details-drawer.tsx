import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import type { Property } from '../model';
import {
  awaitingCorrection,
  editableByViewer,
} from '../../../lib/property-adapter';
import {
  PropertyDetailHeader,
  PropertyDetailSections,
} from '../../manager-properties/components/property-detail-sections';
import detailStyles from '../../manager-properties/components/property-detail-sections.module.css';
export function EmployeePropertyDetailsDrawer({
  property: p,
  onClose,
  onBack,
  onEdit,
  readOnly = false,
}: {
  property: Property;
  onClose: () => void;
  onBack?: () => void;
  onEdit: () => void;
  readOnly?: boolean;
}) {
  return (
    <PropertyOverlay
      title={p.title || p.operation}
      drawer
      onClose={onClose}
      onBack={onBack}
      className={detailStyles.drawer}
      headerDetails={
        <PropertyDetailHeader status={p.status} reference={p.code} />
      }
    >
      <PropertyDetailSections details={p.details}>
        {/* Keyed on the stored states, not on the label: both a REJECTED row
            and a PENDING row sent back for changes must keep offering the
            correction + resubmission action. */}
        {!readOnly && awaitingCorrection(p) && p.mine ? (
          <Button onClick={onEdit}>تعديل وإعادة إرسال</Button>
        ) : null}
        {/* An approved row the viewer created is still editable: saving sends
            it back to manager review (PENDING) with a fresh approval request.
            Only the server-derived creator flag opens this — never another
            employee's approved listing. */}
        {!readOnly && editableByViewer(p) && !awaitingCorrection(p) ? (
          <Button onClick={onEdit}>تعديل العقار</Button>
        ) : null}
      </PropertyDetailSections>
      {/* Follow-up history has no backend persistence yet, so the block is
          hidden instead of rendering an empty tab strip. */}
    </PropertyOverlay>
  );
}
