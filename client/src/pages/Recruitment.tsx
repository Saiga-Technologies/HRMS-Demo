import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Recruitment() {
  usePageTour('Recruitment', []);
  return <PageHeader title="Recruitment" subtitle="Coming soon" />;
}
