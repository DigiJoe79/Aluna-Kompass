import type { DocumentTemplate } from '@kompass/core';
import { admissionTemplate } from './admission';
import { countCertificateTemplate } from './count-certificate';
import { feeNoticeTemplate } from './fee-notice';
import { rejectionTemplate } from './rejection';
import { paymentRequestTemplate, reminderTemplate } from './reminder';
import { resignationTemplate } from './resignation';

/** Die Vorlagen des Moduls für das Manifest (`documentTemplates`). */
export const memberLetterTemplates: DocumentTemplate[] = [admissionTemplate, resignationTemplate, rejectionTemplate, reminderTemplate, paymentRequestTemplate, feeNoticeTemplate, countCertificateTemplate as DocumentTemplate] as DocumentTemplate[];
