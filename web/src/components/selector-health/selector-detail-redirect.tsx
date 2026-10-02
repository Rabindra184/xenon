import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { legacyDetailTarget } from './view-state';

/** The retired detail page's address, sent on to the side panel (or a search). */
export const SelectorDetailRedirect: React.FC = () => {
  const [params] = useSearchParams();
  return <Navigate to={legacyDetailTarget(params)} replace />;
};

export default SelectorDetailRedirect;
