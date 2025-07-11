const axios = require('axios');

class ApiService {
  constructor() {
    this.baseURL = 'https://api.github.com';
  }

  async fetchData() {
    try {
      const response = await axios.get(`${this.baseURL}/repos/hackingco/claude-code-flow`);
      return {
        repository: response.data.full_name,
        stars: response.data.stargazers_count,
        forks: response.data.forks_count,
        language: response.data.language,
        description: response.data.description,
      };
    } catch (error) {
      throw new Error(`Failed to fetch data: ${error.message}`);
    }
  }
}

module.exports = ApiService;
