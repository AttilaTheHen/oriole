import React, { FC, useState, useEffect } from 'react';
import { Text, Box, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import * as child from 'child_process';
import { getData } from '../../utils/store';
import { pushHarvestEntry, getHarvestData } from '../../utils/harvest/harvest';
import { isValidDate } from '../../utils/helpers';
import { Error } from '../Error';
import {
  HarvestError,
  TimeEntryGetResponse,
  TimeEntryPostRequest,
} from '../../utils/harvest/harvest.interface';
import { CommitsProps, Choice, EntryData, ExistingEntryData } from './Commits.interface';

export const Commits: FC<CommitsProps> = ({ hours, commitDate }) => {
  const { exit } = useApp();
  const [formattedDate, setFormattedDate] = useState('');
  const [gitLog, setGitLog] = useState('');
  const [showGitLog, setShowGitLog] = useState(false);
  const [existingEntry, setExistingEntry] = useState<ExistingEntryData>({});
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [entryData, setEntryData] = useState<EntryData>({});
  const [error, setError] = useState<HarvestError>();
  const [success, setSuccess] = useState('');
  const choices: Choice[] = [
    { label: 'Yes', value: 'y' },
    { label: 'No', value: 'n' },
  ];
  const existingChoices: Choice[] = [
    { label: 'Replace', value: 'r' },
    { label: 'Create', value: 'c' },
  ];
  const currentDir = process.cwd().split('/');
  const dirName = currentDir[currentDir.length - 1];

  useEffect(() => {
    if (!commitDate) {
      // get date as YYYY-MM-DD, in a way that's compatible with Node v12 and older
      // see this answer for why we can't do this a simpler way, like using toLocaleDateString:
      // https://stackoverflow.com/a/56624712
      // Format the month and force it to always be two digits: https://stackoverflow.com/a/47774150
      const spentMonth = `${new Date().getMonth() + 1}`.padStart(2, '0');
      // Format the day and force it to always be two digits: https://stackoverflow.com/a/47774150
      const spentDay = `${new Date().getDate()}`.padStart(2, '0');
      setFormattedDate(`${new Date().getFullYear()}-${spentMonth}-${spentDay}`);
    } else if (commitDate && !isValidDate(commitDate)) {
      setSuccess('Please enter a valid date, formatted as "YYYY-MM-DD".');
    } else {
      setFormattedDate(commitDate);
    }
  }, [formattedDate]);

  const checkDirInit = async () => {
    const token = await getData('token');
    const accountId = await getData('accountId');
    const projectId = await getData(`${dirName}.projectId`);
    const taskId = await getData(`${dirName}.taskId`);

    if (!token || !accountId) {
      return 'No Harvest credentials found. Please run `oriole setup`, then `oriole init` in this directory, then try again.';
    }
    if (!projectId || !taskId) {
      return 'No Harvest project and/or task information found. Please run `oriole init` and try again.';
    }
    setEntryData({ projectId, taskId });
    return true;
  };

  if (!gitLog && !success) {
    checkDirInit().then((res) => {
      if (res !== true) {
        setSuccess(res);
      } else {
        let log = '';
        if (commitDate) {
          // if date has been specified, get all the commits just on that day
          log = child
            .execSync(
              `git log --author=$(git config user.email) --format="- %B" --no-merges --after="${commitDate} 00:00" --before="${commitDate} 23:59" --reverse`,
            )
            .toString();
        } else {
          // if no date has been specified, just grab the log from today
          log = child
            .execSync(
              'git log --author=$(git config user.email) --format="- %B" --no-merges --since=midnight --reverse',
            )
            .toString();
        }
        // if there's no git log (aka no commits were made today or on the specified date), show message and exit
        if (!log) {
          setSuccess(
            `No valid commits found for ${commitDate || 'today'}.\n(Merge commits are not considered valid.)`,
          );
          // else, format the outputted git log and set it as the gitLog variable value
        } else {
          const formattedLog = log.replace(/(^[ \t]*\n)/gm, '');
          setGitLog(formattedLog);
        }
      }
    });
  }

  const pushEntry = (
    method: string,
    body: TimeEntryPostRequest,
    successMessage: string,
    entryId?: string,
  ) => {
    pushHarvestEntry(`https://api.harvestapp.com/v2/time_entries/${entryId || ''}`, method, body)
      .then(() => {
        setSuccess(successMessage);
        exit();
      })
      .catch((err) => {
        setError(JSON.parse(err.message));
        exit();
      });
  };

  useEffect(() => {
    // guard against useEffect running automatically on mount
    if (!gitLog) {
      return;
    }
    // Get all time entries for this date
    getHarvestData(`https://api.harvestapp.com/v2/time_entries?from=${formattedDate}`).then(
      (response) => {
        if (response.time_entries.length) {
          // See if any of the time entries are the same project and task
          const foundEntry = response.time_entries.find(
            (entry: TimeEntryGetResponse) =>
              entry.project.id === Number(entryData.projectId) && entry.task.id === Number(entryData.taskId),
          );
          // If the formattedLog exists inside the foundEntry's notes, say so and quit - we don't need to push it up again
          if (foundEntry && foundEntry.notes.includes(gitLog)) {
            setSuccess(`Your latest commits are already in Harvest and will not be pushed up.\nHere is the full entry:\n\n${foundEntry.notes}`);
          } else if (foundEntry) {
            // If they are the same project and task, set existingId to true and show the existing entry questions
            setExistingEntry(foundEntry);
          } else {
            // Otherwise, set showGitLog to true and show the new entry questions
            setShowGitLog(true);
          }
        } else {
          // Otherwise, if there are no time entries for the day, same thing - set showGitLog to true and show the new entry questions
          setShowGitLog(true);
        }
      },
    );
  }, [gitLog]);

  const handleSelect = async (item: Choice) => {
    if (item.value === 'y') {
      const projectId = Number(entryData.projectId);
      const taskId = Number(entryData.taskId);
      // TODO: Allow user to add custom date as flag, --date yyyy-mm-dd?
      const body = {
        project_id: projectId,
        task_id: taskId,
        spent_date: formattedDate,
        hours,
        notes: gitLog,
      };
      const message = 'Your commits have been successfully pushed up to Harvest.';
      pushEntry('POST', body, message);
    } else {
      setSuccess('Your commits will not be pushed up.');
      exit();
    }
  };

  const handleExistingSelect = async (item: Choice) => {
    const projectId = Number(entryData.projectId);
    const taskId = Number(entryData.taskId);
    const message = 'A new time entry has been pushed up to Harvest.';
    const body = {
      project_id: projectId,
      task_id: taskId,
      spent_date: formattedDate,
      hours,
      notes: gitLog,
    };
    if (item.value === 'r') {
      setConfirmReplace(true);
    } else {
      // TODO: Allow user to add custom date as flag, --date yyyy-mm-dd?
      pushEntry('POST', body, message);
    }
  };

  const handleReplaceConfirmSelect = async (item: Choice) => {
    if (item.value === 'y') {
      const projectId = Number(entryData.projectId);
      const taskId = Number(entryData.taskId);
      const message = 'Your existing time entry has been successfully replaced with the new commits.';
      const body = {
        project_id: projectId,
        task_id: taskId,
        spent_date: formattedDate,
        hours,
        notes: gitLog,
      };
      pushEntry('PATCH', body, message, existingEntry.id);
    } else {
      setSuccess('Your commits will not be pushed up. No changes have been made to your Harvest entries.');
    }
  };

  // TODO: Componentize everything to clean up ternary?
  return (
    <Box flexDirection='column'>
      {success ? (
        <Box marginBottom={1}>
          <Text>{success}</Text>
        </Box>
      ) : null}
      {!success && error && error.status ? (
        <Box marginBottom={1}>
          <Error status={error.status} />
        </Box>
      ) : null}
      {!success && !error && !existingEntry.id && gitLog && showGitLog ? (
        <Box flexDirection='column'>
          {commitDate ? (
            <Text>Here are the commits made in this repo on {commitDate}:</Text>
          ) : (
            <Text>Here are your latest commits in this repo:</Text>
          )}
          <Box marginTop={1} flexDirection='column'>
            <Text>{gitLog}</Text>
            <Box flexDirection='column'>
              <Text>Push these up to Harvest?</Text>
              <SelectInput items={choices} onSelect={handleSelect} />
            </Box>
          </Box>
        </Box>
      ) : null}
      {!success && !error && existingEntry.id && !confirmReplace ? (
        <Box flexDirection='column'>
          <Box marginBottom={1}>
            <Text color='red'>We&apos;ve found an existing entry on Harvest with the same project and task.</Text>
          </Box>
          <Text color='blue'>This is the existing entry:</Text>
          <Box marginTop={1} marginBottom={1}>
            <Text>{existingEntry.notes}</Text>
          </Box>
          <Text color='blue'>And here are the latest commits that you&apos;re trying to push:</Text>
          <Box marginTop={1}>
            <Text>{gitLog}</Text>
          </Box>
          <Box marginTop={1} flexDirection='column'>
            <Text>Would you like to replace the existing entry, or create a new entry?</Text>
            <SelectInput items={existingChoices} onSelect={handleExistingSelect} />
          </Box>
        </Box>
      ) : null}
      {!success && !error && existingEntry.id && confirmReplace ? (
        <Box flexDirection='column'>
          <Text color='red' bold>WARNING: This will PERMANENTLY DELETE this existing Harvest entry:</Text>
          <Box marginTop={1} marginBottom={1}>
            <Text color='red'>{existingEntry.notes}</Text>
          </Box>
          <Text color='green' bold>And replace it with this one:</Text>
          <Box marginTop={1}>
            <Text color='green'>{gitLog}</Text>
          </Box>
          <Box marginTop={1} flexDirection='column'>
            <Text>Are you sure?</Text>
            <SelectInput items={choices} onSelect={handleReplaceConfirmSelect} />
          </Box>
        </Box>
      ) : null}
    </Box>
  );
};
