import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentUser } from '../utils/auth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500 text-lg">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
