import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Careers() {
  usePageTour('Careers', []);
  return <PageHeader title="Careers" subtitle="Coming soon" />;
}
