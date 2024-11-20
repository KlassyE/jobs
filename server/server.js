require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdf = require('pdf-parse');
const cors = require('cors');
const axios = require('axios');
const Queue = require('bull');
const playwright = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

const applicationQueue = new Queue('job-applications', process.env.REDIS_URL);
const upload = multer({ storage: multer.memoryStorage() });

// Integrated job categories and scoring configuration
const jobCategories = {
  software: {
    keywords: ['javascript', 'python', 'java', 'software developer', 'programmer'],
    adzunaCategory: 'it-jobs',
    criticalKeywords: ['javascript', 'python', 'java'],
    minScore: 40,
    suggestions: ['Consider adding specific programming languages', 'List your technical projects']
  },
  marketing: {
    keywords: ['marketing', 'digital marketing', 'social media'],
    adzunaCategory: 'marketing-jobs',
    criticalKeywords: ['marketing'],
    minScore: 40,
    suggestions: ['Highlight campaign metrics', 'Include social media platforms managed']
  },
  finance: {
    keywords: ['accountant', 'financial analyst', 'finance'],
    adzunaCategory: 'finance-jobs',
    criticalKeywords: ['accountant', 'financial analyst'],
    minScore: 40,
    suggestions: ['Highlight financial metrics', 'Include financial software']
  },
  healthcare: {
    keywords: ['nurse', 'doctor', 'healthcare'],
    adzunaCategory: 'healthcare-jobs',
    criticalKeywords: ['nurse', 'doctor'],
    minScore: 40,
    suggestions: ['Highlight healthcare metrics', 'Include healthcare software']
  },
  officeAdmin: {
    keywords: ['administrative assistant', 'office manager', 'receptionist','administrator','typing'],
    adzunaCategory: 'admin-jobs',
    criticalKeywords: ['administrative assistant', 'office manager','administrator','typing'],
    minScore: 40,
    suggestions: ['Highlight administrative metrics', 'Include administrative software']
  }
};

// Integrated Resume Analysis Service
async function analyzeResume(pdfBuffer, category = 'software') {
  try {
    const data = await pdf(pdfBuffer);
    const resumeText = data.text.toLowerCase();
    const categoryConfig = jobCategories[category];
    
    const matchingKeywords = [];
    const missingKeywords = [];
    
    categoryConfig.keywords.forEach(keyword => {
      if (resumeText.includes(keyword.toLowerCase())) {
        matchingKeywords.push(keyword);
      } else {
        missingKeywords.push(keyword);
      }
    });

    const keywordScore = (matchingKeywords.length / categoryConfig.keywords.length) * 100;
    const hasCriticalKeywords = categoryConfig.criticalKeywords.some(
      keyword => matchingKeywords.includes(keyword)
    );
    
    const finalScore = hasCriticalKeywords ? 
      Math.max(keywordScore, categoryConfig.minScore) : 
      Math.min(keywordScore, categoryConfig.minScore);

    const suggestions = [
      `Your resume matches ${matchingKeywords.length} keywords for ${category} positions.`,
      matchingKeywords.length > 0 ? `Matching keywords: ${matchingKeywords.join(', ')}` : '',
      missingKeywords.length > 0 ? `Consider adding these relevant keywords: ${missingKeywords.slice(0, 5).join(', ')}` : '',
      ...categoryConfig.suggestions
    ].filter(Boolean).join('\n');

    return {
      score: Math.round(finalScore),
      matchingKeywords,
      missingKeywords,
      suggestions
    };
  } catch (error) {
    console.error('Resume analysis failed:', error);
    throw error;
  }
}

// Integrated Job Search Service
async function searchJobs(keywords, category, includeRemote = true) {
  try {
    const searchQuery = category === 'officeAdmin' 
      ? 'administrative OR office' 
      : keywords[0] || jobCategories[category].keywords[0];
    
    const response = await axios({
      url: 'https://jsearch.p.rapidapi.com/search',
      method: 'GET',
      params: {
        query: `${searchQuery} ${includeRemote ? 'remote' : ''}`,
        page: '1',
        num_pages: '1'
      },
      headers: {
        'X-RapidAPI-Key': process.env.JSEARCH_API_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }
    });

    if (!response.data || !response.data.data) {
      console.log('No results found');
      return [];
    }

    return response.data.data.map(job => ({
      id: job.job_id,
      title: job.job_title,
      company: job.employer_name || 'Unknown Company',
      location: job.job_city ? `${job.job_city}, ${job.job_country}` : job.job_country,
      description: job.job_description || '',
      salary_min: job.job_min_salary || null,
      salary_max: job.job_max_salary || null,
      redirect_url: job.job_apply_link,
      category: category,
      is_remote: job.job_is_remote,
      country: job.job_country
    }));

  } catch (error) {
    console.error('Job search failed:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    return [];
  }
}

// Integrated Application Service
async function automateApplication(jobData, browser) {
  const page = await browser.newPage();
  try {
    await page.goto(jobData.redirect_url, { waitUntil: 'networkidle' });
    
    // Common form field selectors
    const selectors = {
      name: ['input[name*="name" i]', 'input[placeholder*="name" i]'],
      email: ['input[type="email"]', 'input[name*="email" i]'],
      resume: ['input[type="file"]', 'input[accept=".pdf"]'],
      submit: ['button[type="submit"]', 'input[type="submit"]']
    };

    // Try to fill form fields
    for (const [field, fieldSelectors] of Object.entries(selectors)) {
      for (const selector of fieldSelectors) {
        try {
          const element = await page.waitForSelector(selector, { timeout: 5000 });
          if (element) {
            if (field === 'resume' && jobData.resumeData) {
              await element.setInputFiles(jobData.resumeData);
            } else if (jobData[field]) {
              await element.fill(jobData[field]);
            }
            break;
          }
        } catch (e) {
          console.log(`Selector ${selector} not found for ${field}`);
        }
      }
    }

    return {
      status: 'ready',
      applicationUrl: page.url()
    };
  } catch (error) {
    console.error('Application automation failed:', error);
    throw error;
  } finally {
    await page.close();
  }
}

// Main upload endpoint
app.post('/upload-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const jobCategory = req.body.jobCategory || 'software';
    const includeRemote = req.body.includeRemote === 'true';
    
    if (!jobCategories[jobCategory]) {
      return res.status(400).json({ 
        error: `Invalid category. Available: ${Object.keys(jobCategories).join(', ')}` 
      });
    }

    const analysis = await analyzeResume(req.file.buffer, jobCategory);
    const searchKeywords = analysis.matchingKeywords.length > 0 
      ? analysis.matchingKeywords.slice(0, 5) 
      : jobCategories[jobCategory].keywords.slice(0, 5);

    const jobs = await searchJobs(searchKeywords, jobCategory, includeRemote);

    console.log(`Found ${jobs.length} jobs globally for category ${jobCategory}`);

    // Group jobs by country for better organization
    const jobsByCountry = jobs.reduce((acc, job) => {
      const country = job.country;
      if (!acc[country]) {
        acc[country] = [];
      }
      acc[country].push(job);
      return acc;
    }, {});

    res.json({
      category: jobCategory,
      atsScore: analysis.score,
      suggestions: analysis.suggestions,
      keywords: analysis.matchingKeywords,
      missingKeywords: analysis.missingKeywords,
      totalJobs: jobs.length,
      jobsByCountry: jobsByCountry,
      jobs: jobs // Keep the flat array for backward compatibility
    });

  } catch (error) {
    console.error('Upload failed:', error);
    res.status(500).json({ 
      error: 'Failed to process resume',
      details: error.message 
    });
  }
});

// Mass application endpoint
app.post('/mass-apply', async (req, res) => {
  try {
    const { jobs, resumeData } = req.body;
    
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({ error: 'No jobs provided' });
    }

    const applicationPromises = jobs.map(jobData => 
      applicationQueue.add({
        ...jobData,
        resumeData,
        isMassApplication: true
      })
    );

    const queuedJobs = await Promise.all(applicationPromises);

    res.json({
      status: 'queued',
      jobIds: queuedJobs.map(job => job.id),
      message: `Queued ${queuedJobs.length} applications`
    });
  } catch (error) {
    console.error('Mass application failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Process application queue
applicationQueue.process(async (job) => {
  const browser = await playwright.chromium.launch();
  try {
    return await automateApplication(job.data, browser);
  } finally {
    await browser.close();
  }
});

// Add a test endpoint to verify job search
app.get('/test-job-search', async (req, res) => {
  try {
    const category = req.query.category || 'software';
    const keywords = jobCategories[category].keywords;
    
    console.log(`Testing job search for category: ${category}`);
    const jobs = await searchJobs(keywords, category, true);
    
    res.json({
      success: true,
      category,
      jobCount: jobs.length,
      jobs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

app.get('/adzuna-jobs', async (req, res) => {
  try {
    const { category, remote } = req.query;
    const baseUrl = 'https://api.adzuna.com/v1/api/jobs';
    const country = 'us'; // or change to your preferred country code
    
    const response = await axios.get(
      `${baseUrl}/${country}/search/1?` + 
      `app_id=${process.env.ADZUNA_APP_ID}&` +
      `app_key=${process.env.ADZUNA_API_KEY}&` +
      `what=${category}&` +
      `content-type=application/json`
    );

    // Filter for remote jobs if requested
    let jobs = response.data.results;
    if (remote === 'true') {
      jobs = jobs.filter(job => 
        job.description?.toLowerCase().includes('remote') ||
        job.title?.toLowerCase().includes('remote')
      );
    }

    res.json(jobs);
  } catch (error) {
    console.error('Adzuna API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch Adzuna jobs' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});