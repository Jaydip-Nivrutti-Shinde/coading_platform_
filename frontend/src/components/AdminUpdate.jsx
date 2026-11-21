import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import axiosClient from '../utils/axiosClient';
import { apiErrorMessage } from '../utils/apiErrorMessage';

export default function AdminUpdate() {
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { state } = useLocation();
  useEffect(() => {
    let cancelled = false;
    axiosClient.get('/problem/getAllProblem').then(({ data }) => {
      if (!cancelled) setProblems(data);
    }).catch(error => {
      if (!cancelled) setError(apiErrorMessage(error, 'Failed to load problems'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return (
    <main className="container mx-auto p-6">
      <Link to="/admin" className="btn btn-ghost mb-4">Back to admin</Link>
      <h1 className="text-3xl font-bold mb-6">Update Problems</h1>
      {state?.message && <div role="status" className="alert alert-success mb-4">{state.message}</div>}
      {loading && <p role="status">Loading problems...</p>}
      {error && <div role="alert" className="alert alert-error">{error}</div>}
      {!loading && !error && (problems.length ? (
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Title</th><th>Difficulty</th><th>Tag</th><th>Actions</th></tr></thead>
          <tbody>{problems.map(problem => <tr key={problem._id}>
            <td>{problem.title}</td><td>{problem.difficulty}</td><td>{problem.tags}</td>
            <td><Link className="btn btn-warning btn-sm" to={`/admin/update/${problem._id}`}>Edit</Link></td>
          </tr>)}</tbody>
        </table></div>
      ) : <p>No problems found. <Link to="/admin/create" className="link">Create a problem</Link>.</p>)}
    </main>
  );
}
