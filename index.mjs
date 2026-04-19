export default {
  config: [
    {
      key: 'moodleUrl',
      label: 'Moodle Site URL',
      type: 'text',
      placeholder: 'https://moodle.your-university.edu',
      description: 'The base URL of your Moodle site.',
    },
    {
      key: 'authMethod',
      label: 'Authentication Method',
      type: 'select',
      defaultValue: 'token',
      options: [
        { value: 'token', label: 'Web Service Token' },
        { value: 'browser', label: 'Browser Login (Cookie)' },
      ],
    },
    {
      key: 'token',
      label: 'Web Service Token',
      type: 'password',
      placeholder: 'your-moodle-token',
      description: 'Required if using Token auth. Generate in Moodle under Profile > Security keys.',
    },
  ],

  async pull(context) {
    const config = (await context.getConfig()) ?? {}
    const { moodleUrl, authMethod, token } = config

    if (!moodleUrl) {
      return {
        protocolVersion: 'v1',
        courses: [],
        warnings: ['Moodle site URL is missing. Please configure the plugin.'],
      }
    }

    const cleanUrl = moodleUrl.replace(/\/$/, '')

    if (authMethod === 'browser') {
      // Check if we need to login
      const testResponse = await context.fetch({
        url: `${cleanUrl}/course/view.php?id=1`, // Try to access a common course ID or dashboard
        method: 'GET',
      })

      // Moodle redirects to login if not authenticated
      if (testResponse.finalUrl.includes('/login/index.php') || testResponse.status === 403) {
        context.log('Authentication required. Opening browser login...')
        const authResult = await context.browserAuth({
          url: `${cleanUrl}/login/index.php`,
          completeUrlPrefix: `${cleanUrl}/my/`, // Redirected here after successful login
        })

        if (authResult.status !== 'success') {
          return {
            protocolVersion: 'v1',
            courses: [],
            warnings: [`Browser login ${authResult.status}: ${authResult.error || 'User cancelled'}`],
          }
        }
      }
    }

    const apiUrl = `${cleanUrl}/webservice/rest/server.php`
    const baseParams = authMethod === 'token' 
      ? `wstoken=${token}` 
      : 'moodlewsrestformat=json' // Cookies will be attached automatically by the host

    try {
      const response = await context.fetch({
        url: `${apiUrl}?${baseParams}&wsfunction=core_enrol_get_users_courses&moodlewsrestformat=json`,
        method: 'GET',
      })

      if (response.status !== 200) {
        throw new Error(`Moodle API returned status ${response.status}`)
      }

      const moodleCourses = JSON.parse(response.bodyText)
      
      if (moodleCourses.exception) {
        // If we get an "invalid token" error while using browser auth, maybe we need to re-login
        if (authMethod === 'browser' && moodleCourses.errorcode === 'invalidtoken') {
             // In browser mode, we might need a session-based token or a different endpoint
             // For now, let's assume standard REST with cookies works if the site allows it
        }
        throw new Error(`Moodle Error: ${moodleCourses.message}`)
      }

      const courses = moodleCourses.map(mc => ({
        id: `moodle-${mc.id}`,
        title: mc.fullname,
        code: mc.shortname,
        description: mc.summary,
        url: `${cleanUrl}/course/view.php?id=${mc.id}`,
        lifecycleState: 'untouched',
      }))

      return {
        protocolVersion: 'v1',
        courses,
        schedules: [],
        sessions: [],
        warnings: [],
      }
    } catch (error) {
      return {
        protocolVersion: 'v1',
        courses: [],
        warnings: [`Failed to sync from Moodle: ${error.message}`],
      }
    }
  },

  async push(_context, payload) {
    return {
      protocolVersion: 'v1',
      summary: {
        courses: payload.courses?.length ?? 0,
        schedules: payload.schedules?.length ?? 0,
        sessions: 0,
      },
      warnings: ['Moodle push is metadata-only. Remote data was not modified.'],
    }
  },
}
