import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function EmployeeDetail() {
  usePageTour('EmployeeDetail', []);
  return <PageHeader title="EmployeeDetail" subtitle="Coming soon" />;
}
