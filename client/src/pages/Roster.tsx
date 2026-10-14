import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Roster() {
  usePageTour('Roster', []);
  return <PageHeader title="Roster" subtitle="Coming soon" />;
}
