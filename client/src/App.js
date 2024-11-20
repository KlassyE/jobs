import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://jobs-svzl.onrender.com';

function App() {
  const [file, setFile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [atsScore, setAtsScore] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('software');
  const [includeRemote, setIncludeRemote] = useState(true);
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) return;

    setError(null);
    setLoading(true);

    const formData = new FormData();
    formData.append('resume', file);
    formData.append('jobCategory', selectedCategory);
    formData.append('includeRemote', includeRemote);

    try {
      const [jSearchResponse, adzunaResponse] = await Promise.all([
        axios.post(`${API_URL}/upload-resume`, formData),
        axios.get(`${API_URL}/adzuna-jobs?category=${selectedCategory}&remote=${includeRemote}`)
      ]);

      const combinedJobs = [
        ...jSearchResponse.data.jobs,
        ...adzunaResponse.data.map(job => ({
          id: job.id,
          title: job.title,
          company: job.company.display_name,
          location: job.location.display_name,
          is_remote: job.description?.toLowerCase().includes('remote'),
          salary_min: job.salary_min,
          salary_max: job.salary_max,
          description: job.description,
          redirect_url: job.redirect_url
        }))
      ];

      setJobs(combinedJobs);
      setAtsScore(jSearchResponse.data.atsScore);
      setSuggestions(jSearchResponse.data.suggestions);
    } catch (error) {
      console.error('Upload failed:', error);
      setError(error.response?.data?.error || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickApply = (job) => {
    if (job.redirect_url) {
      window.open(job.redirect_url, '_blank');
    } else {
      alert('Application URL not available');
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Job Matchmaker</h1>
      </header>

      <main>
        <section className="upload-section">
          <form onSubmit={handleUpload}>
            <div className="category-select">
              <label htmlFor="category">Select Job Category: </label>
              <select
                id="category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="software">Software</option>
                <option value="marketing">Marketing</option>
                <option value="finance">Finance</option>
                <option value="healthcare">Healthcare</option>
                <option value="officeAdmin">Office Admin</option>
              </select>
            </div>

            <div className="remote-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={includeRemote}
                  onChange={(e) => setIncludeRemote(e.target.checked)}
                />
                Include Remote Jobs
              </label>
            </div>

            <input type="file" onChange={handleFileChange} accept=".pdf" />
            <button type="submit" disabled={!file || loading}>
              {loading ? 'Uploading...' : 'Upload Resume'}
            </button>
          </form>
          
          {error && (
            <div className="error-message">
              <p>{error}</p>
            </div>
          )}
        </section>

        {atsScore !== null && (
          <section className="ats-section">
            <h2>ATS Score: {atsScore}%</h2>
            {suggestions && (
              <div className="suggestions">
                <h3>Suggestions for Improvement:</h3>
                <pre>{suggestions}</pre>
              </div>
            )}
          </section>
        )}

        <section className="jobs-section">
          {loading ? (
            <div className="loading">Loading jobs...</div>
          ) : jobs.length === 0 ? (
            <div className="no-jobs-message">
              <p>No jobs found. Try adjusting your filters or enabling remote jobs.</p>
            </div>
          ) : (
            jobs.map(job => (
              <div key={job.id} className="job-card">
                <h3>{job.title || 'No Title'}</h3>
                <p className="company">{typeof job.company === 'string' ? job.company : job.company?.display_name || 'Unknown Company'}</p>
                <p className="location">
                  {job.is_remote ? '🌐 Remote' : `📍 ${typeof job.location === 'string' ? job.location : job.location?.display_name || 'Location not specified'}`}
                </p>
                {job.salary_min && job.salary_max && (
                  <p className="salary">
                    ${job.salary_min.toLocaleString()} - ${job.salary_max.toLocaleString()}
                  </p>
                )}
                <p className="description">
                  {job.description?.substring(0, 200)}...
                </p>
                <button 
                  onClick={() => handleQuickApply(job)}
                  className="quick-apply-button"
                >
                  Quick Apply
                </button>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}

export default App;