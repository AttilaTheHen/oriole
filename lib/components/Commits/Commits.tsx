import React, { FC, useState } from 'react';
import { Text, Box, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import * as child from 'child_process';
import { getData } from '../../utils/store';
import { pushHarvestEntry, getHarvestData } from '../../utils/harvest/harvest';
import { Error } from '../Error';
import {
  HarvestError,
  TimeEntryGetResponse,
  TimeEntryPostRequest,
} from '../../utils/harvest/harvest.interface';
import { CommitsProps, Choice, EntryData, ExistingEntryData } from './Commits.interface';

export const Commits: FC<CommitsProps> = ({ hours }) => {
  const { exit } = useApp();
  const [gitLog, setGitLog] = useState('');
  const [showGitLog, setShowGitLog] = useState(false);
  const [existingEntry, setExistingEntry] = useState<ExistingEntryData>({});
  const [entryData, setEntryData] = useState<EntryData>({});
  const [error, setError] = useState<HarvestError>();
  const [success, setSuccess] = useState('');
  const choices: Choice[] = [
    { label: 'Yes', value: 'y' },
    { label: 'No', value: 'n' },
  ];
  const existingChoices: Choice[] = [
    { label: 'Replace', value: 'r' },
    { label: 'Add', value: 'a' },
  ];
  const currentDir = process.cwd().split('/');
  const dirName = currentDir[currentDir.length - 1];
  const spentDate = new Date().toLocaleDateString('en-CA'); // today as yyyy-mm-dd

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

  const checkExistingEntry = async () => {
    // Get all time entries for this date
    getHarvestData(`https://api.harvestapp.com/v2/time_entries?from=${spentDate}`).then(
      (response) => {
        if (response.time_entries.length) {
          // See if any of the time entries are the same project and task
          const foundEntry = response.time_entries.find(
            (entry: TimeEntryGetResponse) =>
              entry.project.id === Number(entryData.projectId) && entry.task.id === Number(entryData.taskId),
          );
          // If the formattedLog exists inside the foundEntry's notes, say so and quit - we don't need to push it up again
          console.log('git log', gitLog);
          if (foundEntry && foundEntry.notes.includes(gitLog)) {
            setSuccess(`Your latest commits are .\nHere is the entry:\n\n${foundEntry.notes}`);
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
  };

  const handleSelect = async (item: Choice) => {
    if (item.value === 'y') {
      const projectId = Number(entryData.projectId);
      const taskId = Number(entryData.taskId);
      // TODO: Allow user to add custom date as flag, --date yyyy-mm-dd?
      const body = {
        project_id: projectId,
        task_id: taskId,
        spent_date: spentDate,
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
    const mergedNotes = `${existingEntry.notes}\n\n${gitLog}`;
    let mergedHours = 0;
    if (existingEntry && existingEntry.hours && hours) {
      // This will never not be true, since handleExistingSelect will only run if existingEntry, well, exists.
      // Same goes for hours, except for the entire push command. But the linter gets made without this guard clause.
      mergedHours = existingEntry.hours + hours;
    }
    // TODO: Allow user to add custom date as flag, --date yyyy-mm-dd?
    const body = {
      project_id: projectId,
      task_id: taskId,
      spent_date: spentDate,
      hours: mergedHours,
      notes: mergedNotes,
    };
    let message = 'Your existing time entry has been successfully updated.';
    if (item.value === 'r') {
      pushEntry('PATCH', body, message, existingEntry.id);
    } else {
      message = 'A new time entry has been pushed up to Harvest.';
      pushEntry('POST', body, message);
    }
  };

  if (!gitLog && !success) {
    checkDirInit().then((res) => {
      if (res !== true) {
        setSuccess(res);
      } else {
        const log = child
          .execSync(
            'git log --author=$(git config user.email) --format="- %B" --no-merges --since=midnight --reverse',
          )
          .toString();

        // if there's no git log (aka no commits were made today), show message and exit
        if (!log) {
          setSuccess(
            'No valid commits found.\nCommits need to have been made today in order to be considered valid.\nMerge commits are not considered valid.',
          );
          // else, format the outputted git log and set it as the gitLog variable value
        } else {
          // TODO: Think about an option for a ticket heading?
          const formattedLog = log.replace(/(^[ \t]*\n)/gm, '');
          setGitLog(formattedLog);
          checkExistingEntry();
        }
      }
    });
  }

  // TODO: Componentize everything to clean up ternary?
  return (
    <Box flexDirection='column'>
      {success ? (
        <Box marginBottom={1}>
          <Text>{success}</Text>
        </Box>
      ) : null}
      {error && error.status ? (
        <Box marginBottom={1}>
          <Error status={error.status} />
        </Box>
      ) : null}
      {!success && !error && !existingEntry.id && showGitLog ? (
        <Box flexDirection='column'>
          <Text>Here are your latest commits in this repo:</Text>
          <Box marginTop={1} flexDirection='column'>
            <Text>{gitLog}</Text>
            <Box flexDirection='column'>
              <Text>Push these up to Harvest?</Text>
              <SelectInput items={choices} onSelect={handleSelect} />
            </Box>
          </Box>
        </Box>
      ) : null}
      {!success && !error && existingEntry.id ? (
        <Box flexDirection='column'>
          <Text>We&apos;ve found an existing entry on Harvest with the same project and task.</Text>
          <Box marginTop={1} flexDirection='column'>
            <Text>Would you like to merge with the last entry added, or add an entirely new entry?</Text>
            <SelectInput items={existingChoices} onSelect={handleExistingSelect} />
          </Box>
        </Box>
      ) : null}
    </Box>
  );
};
