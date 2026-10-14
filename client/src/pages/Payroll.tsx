import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Payroll() {
  usePageTour('Payroll', []);
  return <PageHeader title="Payroll" subtitle="Coming soon" />;
}
