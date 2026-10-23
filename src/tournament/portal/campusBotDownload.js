import source from '../../../examples/campus_bot.py?raw';

// Keep the Campus download tied to the tested SDK, not the legacy MVP endpoint.
export const campusBotDownload = `data:text/x-python;charset=utf-8,${encodeURIComponent(source)}`;