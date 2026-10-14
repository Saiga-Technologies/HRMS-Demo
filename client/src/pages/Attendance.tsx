import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Attendance() {
  usePageTour('Attendance', []);
  return <PageHeader title="Attendance" subtitle="Coming soon" />;
}
